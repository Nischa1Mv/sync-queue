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
// ----------------------------------------------------------
// Default retry policy: exponential backoff, 3 attempts
// ----------------------------------------------------------
const DEFAULT_RETRY_POLICY = {
    maxAttempts: 3,
    delayMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 30000),
    retryOnReconnect: true,
};
export class SyncQueue {
    constructor(config) {
        this._isSyncing = false;
        this._isConnected = false;
        this._unsubscribeNetwork = null;
        this._listeners = new Set();
        this.config = {
            concurrency: 5,
            storageKey: '@sync-queue/items',
            conflictStrategy: 'client-wins',
            retryPolicy: { ...DEFAULT_RETRY_POLICY, ...config.retryPolicy },
            ...config,
        };
        this.store = new QueueStore(this.config.storage, this.config.storageKey);
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
    async add(input) {
        // Validate before storing
        if (this.config.validator) {
            const result = await this.config.validator(input.payload);
            if (!result.valid) {
                throw new ValidationError(result.errors);
            }
        }
        const item = {
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
    async getAll() {
        return this.store.getAll();
    }
    /**
     * Returns only pending + syncing items.
     */
    async getPending() {
        return this.store.getByStatus('pending', 'syncing');
    }
    /**
     * Returns failed items.
     */
    async getFailed() {
        return this.store.getByStatus('failed');
    }
    /**
     * Resets a failed item to pending for manual retry.
     */
    async resetItem(id) {
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
    async resetAllFailed() {
        const failed = await this.store.getByStatus('failed');
        await Promise.all(failed.map((i) => this.resetItem(i.id)));
    }
    /**
     * Removes a specific item from the queue.
     */
    async removeItem(id) {
        await this.store.remove(id);
        this._notifyListeners();
    }
    /**
     * Wipes the entire queue. Use on logout.
     */
    async clearAll() {
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
    async syncAll() {
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
        ].filter((i) => i.attemptCount <= this.config.retryPolicy.maxAttempts);
        return this._runSync(retryable);
    }
    /**
     * Syncs a single item by ID.
     */
    async syncOne(id) {
        const item = await this.store.getById(id);
        if (!item)
            return this._emptyResult();
        return this._runSync([item]);
    }
    /**
     * Whether a sync is currently in progress.
     */
    get isSyncing() {
        return this._isSyncing;
    }
    /**
     * Whether the device is currently connected.
     */
    get isConnected() {
        return this._isConnected;
    }
    // ----------------------------------------------------------
    // Public: Listeners (for React hooks to subscribe to changes)
    // ----------------------------------------------------------
    /**
     * Subscribe to any queue state change (add, remove, status update).
     * @returns unsubscribe function
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
    /**
     * Unsubscribe from network listener. Call when the queue is no longer needed.
     */
    destroy() {
        this._unsubscribeNetwork?.();
        this._listeners.clear();
    }
    // ----------------------------------------------------------
    // Internal: Network listener (auto-sync on reconnect)
    // ----------------------------------------------------------
    _startNetworkListener() {
        // Check current state immediately
        this.config.network.isConnected().then((connected) => {
            this._isConnected = connected;
        });
        this._unsubscribeNetwork = this.config.network.onConnectivityChange(async (isConnected) => {
            const wasOffline = !this._isConnected;
            this._isConnected = isConnected;
            this._notifyListeners();
            // Auto-sync when coming back online
            if (isConnected && wasOffline) {
                await this.syncAll();
            }
        });
    }
    // ----------------------------------------------------------
    // Internal: Sync orchestration with concurrency batching
    // ----------------------------------------------------------
    async _runSync(items) {
        if (items.length === 0) {
            this._isSyncing = false;
            return this._emptyResult();
        }
        this._notifyListeners();
        const succeeded = [];
        const failed = [];
        const conflicts = [];
        try {
            // Process in batches of `concurrency`
            for (let i = 0; i < items.length; i += this.config.concurrency) {
                const batch = items.slice(i, i + this.config.concurrency);
                const results = await Promise.allSettled(batch.map((item) => this._processItem(item)));
                results.forEach((result, idx) => {
                    const item = batch[idx];
                    if (result.status === 'rejected') {
                        failed.push({ item, outcome: { status: 'failure', error: String(result.reason) } });
                        return;
                    }
                    const outcome = result.value;
                    if (outcome.status === 'success') {
                        succeeded.push(item);
                    }
                    else if (outcome.status === 'conflict') {
                        conflicts.push({ item, outcome });
                    }
                    else {
                        failed.push({ item, outcome });
                    }
                });
            }
        }
        finally {
            this._isSyncing = false;
            this._notifyListeners();
        }
        return { succeeded, failed, conflicts, total: items.length, syncedAt: Date.now() };
    }
    async _processItem(item) {
        // Mark as syncing
        await this.store.update(item.id, {
            status: 'syncing',
            attemptedAt: Date.now(),
            attemptCount: item.attemptCount + 1,
        });
        this._notifyListeners();
        let outcome;
        try {
            outcome = await this.config.onSync({
                item,
                attempt: item.attemptCount + 1,
            });
        }
        catch (err) {
            outcome = {
                status: 'failure',
                error: err instanceof Error ? err.message : String(err),
                retry: true,
            };
        }
        await this._applyOutcome(item, outcome);
        return outcome;
    }
    async _applyOutcome(item, outcome) {
        if (outcome.status === 'success') {
            await this.store.remove(item.id);
            this.config.onSuccess?.(item);
        }
        else if (outcome.status === 'failure') {
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
            }
            else {
                // Permanently failed
                await this.store.update(item.id, {
                    status: 'failed',
                    errorMessage: outcome.error,
                    attemptCount: newAttemptCount,
                });
                this.config.onFailure?.(item, outcome.error);
            }
        }
        else if (outcome.status === 'conflict') {
            await this._resolveConflict(item, outcome.resolution);
        }
        this._notifyListeners();
    }
    // ----------------------------------------------------------
    // Internal: Conflict resolution
    // ----------------------------------------------------------
    async _resolveConflict(item, resolution) {
        const strategy = resolution.strategy ?? this.config.conflictStrategy;
        // Always fire the onConflict callback regardless of strategy
        this.config.onConflict?.(item, resolution);
        if (strategy === 'client-wins') {
            // Re-enqueue with resolved payload (or original if none provided)
            const payload = resolution.resolvedPayload ?? item.payload;
            await this.store.remove(item.id);
            await this.add({ payload, meta: item.meta });
        }
        else if (strategy === 'server-wins') {
            // Discard — server version is authoritative
            await this.store.remove(item.id);
        }
        else if (strategy === 'manual') {
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
    _emptyResult() {
        return { succeeded: [], failed: [], conflicts: [], total: 0, syncedAt: Date.now() };
    }
    _notifyListeners() {
        this._listeners.forEach((l) => l());
    }
}
// ----------------------------------------------------------
// Custom Errors
// ----------------------------------------------------------
export class ValidationError extends Error {
    constructor(errors) {
        super(`Validation failed: ${errors.join(', ')}`);
        this.errors = errors;
        this.name = 'ValidationError';
    }
}
//# sourceMappingURL=SyncQueue.js.map