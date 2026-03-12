// ============================================================
// sync-queue — SyncQueue
// The main class. Owns the queue, network listener, retry logic,
// conflict resolution, and sync orchestration.
//
// Usage:
//   const queue = new SyncQueue({ storage, network, onSync, ... });
//   await queue.add({ payload: formData });     // enqueue
//   await queue.syncAll();                       // manual trigger
//   queue.destroy();                             // cleanup on unmount
// ============================================================

import { QueueStore } from './QueueStore';
import { nanoid } from '../utils/nanoid';
import { sleep } from '../utils/sleep';
import type {
  SyncQueueConfig,
  ResolvedConfig,
  QueueItem,
  AddItemInput,
  SyncResult,
  SyncItemResult,
  SyncOutcome,
  RetryPolicy,
  ValidatorResult,
} from '../types';

// ----------------------------------------------------------
// Default retry policy: exponential backoff, 3 attempts
// ----------------------------------------------------------
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  delayMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 30_000),
  retryOnReconnect: true,
};

export class SyncQueue<TPayload = unknown> {
  private readonly store: QueueStore<TPayload>;
  private readonly config: ResolvedConfig<TPayload>;
  private _isSyncing = false;
  private _isConnected = false;
  private _unsubscribeNetwork: (() => void) | null = null;
  private _listeners: Set<() => void> = new Set();

  constructor(config: SyncQueueConfig<TPayload>) {
    this.config = {
      concurrency: 5,
      storageKey: '@sync-queue/items',
      conflictStrategy: 'client-wins',
      retryPolicy: { ...DEFAULT_RETRY_POLICY, ...config.retryPolicy },
      ...config,
    } as ResolvedConfig<TPayload>;

    this.store = new QueueStore<TPayload>(
      this.config.storage,
      this.config.storageKey
    );

    this._startNetworkListener();
  }

  // ----------------------------------------------------------
  // Public: Queue management
  // ----------------------------------------------------------

  /**
   * Adds an item to the queue.
   * Validates payload if a validator is configured.
   * Triggers auto-sync if currently connected.
   *
   * @throws ValidationError if payload fails validation
   */
  async add(input: AddItemInput<TPayload>): Promise<QueueItem<TPayload>> {
    // Validate before storing
    if (this.config.validator) {
      const result: ValidatorResult = await this.config.validator(
        input.payload
      );
      if (!result.valid) {
        throw new ValidationError(result.errors);
      }
    }

    const item: QueueItem<TPayload> = {
      id: nanoid(),
      payload: input.payload,
      status: 'pending',
      createdAt: Date.now(),
      attemptCount: 0,
      meta: input.meta,
    };

    await this.store.add(item);
    this._notifyListeners();

    // Auto-sync if online
    if (this._isConnected && !this._isSyncing) {
      // Defer so caller gets the item back first
      setTimeout(() => this.syncAll(), 0);
    }

    return item;
  }

  /**
   * Returns all items in the queue.
   */
  async getAll(): Promise<QueueItem<TPayload>[]> {
    return this.store.getAll();
  }

  /**
   * Returns only pending + syncing items.
   */
  async getPending(): Promise<QueueItem<TPayload>[]> {
    return this.store.getByStatus('pending', 'syncing');
  }

  /**
   * Returns failed items.
   */
  async getFailed(): Promise<QueueItem<TPayload>[]> {
    return this.store.getByStatus('failed');
  }

  /**
   * Resets a failed item to pending for manual retry.
   */
  async resetItem(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'pending',
      errorMessage: undefined,
      attemptedAt: undefined,
    });
    this._notifyListeners();
  }

  /**
   * Resets ALL failed items to pending.
   */
  async resetAllFailed(): Promise<void> {
    const failed = await this.store.getByStatus('failed');
    await Promise.all(failed.map((i) => this.resetItem(i.id)));
  }

  /**
   * Removes a specific item from the queue.
   */
  async removeItem(id: string): Promise<void> {
    await this.store.remove(id);
    this._notifyListeners();
  }

  /**
   * Wipes the entire queue. Use on logout.
   */
  async clearAll(): Promise<void> {
    await this.store.clear();
    this._notifyListeners();
  }

  // ----------------------------------------------------------
  // Public: Sync
  // ----------------------------------------------------------

  /**
   * Syncs all pending (and retryable failed) items.
   * Safe to call while already syncing — will no-op.
   */
  async syncAll(): Promise<SyncResult<TPayload>> {
    if (this._isSyncing) {
      return this._emptyResult();
    }

    // Set flag immediately to prevent race conditions
    this._isSyncing = true;

    const eligible = await this.store.getByStatus('pending', 'failed');
    // Also get syncing items that may have exhausted retries or need retry
    const syncingItems = await this.store.getByStatus('syncing');
    const retryable = [
      ...eligible,
      ...syncingItems
    ].filter(
      (i) => i.attemptCount <= this.config.retryPolicy.maxAttempts
    );

    return this._runSync(retryable);
  }

  /**
   * Syncs a single item by ID.
   */
  async syncOne(id: string): Promise<SyncResult<TPayload>> {
    const item = await this.store.getById(id);
    if (!item) return this._emptyResult();
    return this._runSync([item]);
  }

  /**
   * Whether a sync is currently in progress.
   */
  get isSyncing(): boolean {
    return this._isSyncing;
  }

  /**
   * Whether the device is currently connected.
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  // ----------------------------------------------------------
  // Public: Listeners (for React hooks to subscribe to changes)
  // ----------------------------------------------------------

  /**
   * Subscribe to any queue state change (add, remove, status update).
   * @returns unsubscribe function
   */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Unsubscribe from network listener. Call when the queue is no longer needed.
   */
  destroy(): void {
    this._unsubscribeNetwork?.();
    this._listeners.clear();
  }

  // ----------------------------------------------------------
  // Internal: Network listener (auto-sync on reconnect)
  // ----------------------------------------------------------

  private _startNetworkListener(): void {
    // Check current state immediately
    this.config.network.isConnected().then((connected) => {
      this._isConnected = connected;
    });

    this._unsubscribeNetwork = this.config.network.onConnectivityChange(
      async (isConnected) => {
        const wasOffline = !this._isConnected;
        this._isConnected = isConnected;
        this._notifyListeners();

        // Auto-sync when coming back online
        if (isConnected && wasOffline) {
          await this.syncAll();
        }
      }
    );
  }

  // ----------------------------------------------------------
  // Internal: Sync orchestration with concurrency batching
  // ----------------------------------------------------------

  private async _runSync(
    items: QueueItem<TPayload>[]
  ): Promise<SyncResult<TPayload>> {
    if (items.length === 0) {
      this._isSyncing = false;
      return this._emptyResult();
    }

    this._notifyListeners();

    const succeeded: QueueItem<TPayload>[] = [];
    const failed: SyncItemResult<TPayload>[] = [];
    const conflicts: SyncItemResult<TPayload>[] = [];

    try {
      // Process in batches of `concurrency`
      for (let i = 0; i < items.length; i += this.config.concurrency) {
        const batch = items.slice(i, i + this.config.concurrency);
        const results = await Promise.allSettled(
          batch.map((item) => this._processItem(item))
        );

        results.forEach((result, idx) => {
          const item = batch[idx];
          if (result.status === 'rejected') {
            failed.push({ item, outcome: { status: 'failure', error: String(result.reason) } });
            return;
          }

          const outcome = result.value;
          if (outcome.status === 'success') {
            succeeded.push(item);
          } else if (outcome.status === 'conflict') {
            conflicts.push({ item, outcome });
          } else {
            failed.push({ item, outcome });
          }
        });
      }
    } finally {
      this._isSyncing = false;
      this._notifyListeners();
    }

    return { succeeded, failed, conflicts, total: items.length, syncedAt: Date.now() };
  }

  private async _processItem(
    item: QueueItem<TPayload>
  ): Promise<SyncOutcome> {
    // Mark as syncing
    await this.store.update(item.id, {
      status: 'syncing',
      attemptedAt: Date.now(),
      attemptCount: item.attemptCount + 1,
    });
    this._notifyListeners();

    let outcome: SyncOutcome;
    try {
      outcome = await this.config.onSync({
        item,
        attempt: item.attemptCount + 1,
      });
    } catch (err) {
      outcome = {
        status: 'failure',
        error: err instanceof Error ? err.message : String(err),
        retry: true,
      };
    }

    await this._applyOutcome(item, outcome);
    return outcome;
  }

  private async _applyOutcome(
    item: QueueItem<TPayload>,
    outcome: SyncOutcome
  ): Promise<void> {
    if (outcome.status === 'success') {
      await this.store.remove(item.id);
      this.config.onSuccess?.(item);

    } else if (outcome.status === 'failure') {
      const newAttemptCount = item.attemptCount + 1;
      const exhausted = newAttemptCount >= this.config.retryPolicy.maxAttempts;
      const shouldRetry = outcome.retry !== false && !exhausted;

      if (shouldRetry) {
        // Add delay before marking as pending again
        const delay = this.config.retryPolicy.delayMs(newAttemptCount);
        setTimeout(async () => {
          await this.store.update(item.id, { status: 'pending' });
          this._notifyListeners();
          // Retry immediately if still connected and retryOnReconnect is false
          if (this._isConnected && !this.config.retryPolicy.retryOnReconnect) {
            await this.syncOne(item.id);
          }
        }, delay);

        await this.store.update(item.id, {
          status: 'syncing', // stays syncing until delay fires
          errorMessage: outcome.error,
          attemptCount: newAttemptCount,
        });
      } else {
        // Permanently failed
        await this.store.update(item.id, {
          status: 'failed',
          errorMessage: outcome.error,
          attemptCount: newAttemptCount,
        });
        this.config.onFailure?.(item, outcome.error);
      }

    } else if (outcome.status === 'conflict') {
      await this._resolveConflict(item, outcome.resolution);
    }

    this._notifyListeners();
  }

  // ----------------------------------------------------------
  // Internal: Conflict resolution
  // ----------------------------------------------------------

  private async _resolveConflict(
    item: QueueItem<TPayload>,
    resolution: import('../types').ConflictResolution
  ): Promise<void> {
    const strategy = resolution.strategy ?? this.config.conflictStrategy;

    // Always fire the onConflict callback regardless of strategy
    this.config.onConflict?.(item, resolution);

    if (strategy === 'client-wins') {
      // Re-enqueue with resolved payload (or original if none provided)
      const payload = (resolution.resolvedPayload as TPayload) ?? item.payload;
      await this.store.remove(item.id);
      await this.add({ payload, meta: item.meta });

    } else if (strategy === 'server-wins') {
      // Discard — server version is authoritative
      await this.store.remove(item.id);

    } else if (strategy === 'manual') {
      // Mark as failed with conflict info — app UI handles it
      await this.store.update(item.id, {
        status: 'failed',
        errorMessage: `Conflict: ${resolution.reason ?? 'manual resolution required'}`,
      });
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private _emptyResult(): SyncResult<TPayload> {
    return { succeeded: [], failed: [], conflicts: [], total: 0, syncedAt: Date.now() };
  }

  private _notifyListeners(): void {
    this._listeners.forEach((l) => l());
  }
}

// ----------------------------------------------------------
// Custom Errors
// ----------------------------------------------------------

export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'ValidationError';
  }
}
