// ============================================================
// sync-queue — Core Types
// ============================================================

// -----------------------------------------------------------
// Queue Item
// -----------------------------------------------------------

export type ItemStatus = 'pending' | 'syncing' | 'failed' | 'success';

export interface QueueItem<TPayload = unknown> {
  id: string;
  payload: TPayload;
  status: ItemStatus;
  createdAt: number;
  attemptedAt?: number;
  attemptCount: number;
  errorMessage?: string;
  /** Arbitrary metadata the app can attach (e.g. formName, userId, tag) */
  meta?: Record<string, unknown>;
}

export type AddItemInput<TPayload = unknown> = {
  payload: TPayload;
  meta?: Record<string, unknown>;
};

// -----------------------------------------------------------
// Storage Adapter Interface
// Any storage backend must implement this contract.
// -----------------------------------------------------------

export interface StorageAdapter {
  /** Read a value by key. Returns null if not found. */
  getItem<T>(key: string): Promise<T | null>;
  /** Write a value by key. */
  setItem<T>(key: string, value: T): Promise<void>;
  /** Delete a value by key. */
  removeItem(key: string): Promise<void>;
}

// -----------------------------------------------------------
// Network Adapter Interface
// Pluggable so apps can bring @react-native-community/netinfo
// or any other network detection library.
// -----------------------------------------------------------

export interface NetworkAdapter {
  /** Returns true if currently connected to internet */
  isConnected(): Promise<boolean>;
  /**
   * Subscribe to connectivity changes.
   * @returns unsubscribe function
   */
  onConnectivityChange(callback: (isConnected: boolean) => void): () => void;
}

// -----------------------------------------------------------
// Sync Handler
// The app provides this — the library calls it per item.
// -----------------------------------------------------------

export interface SyncHandlerContext<TPayload> {
  item: QueueItem<TPayload>;
  attempt: number;
}

export type SyncOutcome =
  | { status: 'success' }
  | { status: 'failure'; error: string; retry?: boolean }
  | { status: 'conflict'; resolution: ConflictResolution };

export type SyncHandler<TPayload> = (
  context: SyncHandlerContext<TPayload>
) => Promise<SyncOutcome>;

// -----------------------------------------------------------
// Conflict Resolution
// -----------------------------------------------------------

export type ConflictStrategy = 'client-wins' | 'server-wins' | 'manual';

export interface ConflictResolution {
  strategy: ConflictStrategy;
  /** For 'manual': the merged payload to re-enqueue */
  resolvedPayload?: unknown;
  /** Human-readable reason, surfaced in onConflict callback */
  reason?: string;
}

// -----------------------------------------------------------
// Payload Validator
// Optional — the app can provide a Zod schema, custom fn, etc.
// -----------------------------------------------------------

export type ValidatorResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export type PayloadValidator<TPayload> = (
  payload: unknown
) => ValidatorResult | Promise<ValidatorResult>;

// -----------------------------------------------------------
// Retry Policy
// -----------------------------------------------------------

export interface RetryPolicy {
  /** Max number of attempts before marking as permanently failed. Default: 3 */
  maxAttempts: number;
  /**
   * Returns delay in ms before next retry given the attempt number.
   * Default: exponential backoff — 1s, 2s, 4s...
   */
  delayMs: (attempt: number) => number;
  /**
   * If true, only retry when connectivity is restored, not immediately.
   * Default: true
   */
  retryOnReconnect: boolean;
}

// -----------------------------------------------------------
// Sync Result
// -----------------------------------------------------------

export interface SyncItemResult<TPayload = unknown> {
  item: QueueItem<TPayload>;
  outcome: SyncOutcome;
}

export interface SyncResult<TPayload = unknown> {
  succeeded: QueueItem<TPayload>[];
  failed: SyncItemResult<TPayload>[];
  conflicts: SyncItemResult<TPayload>[];
  total: number;
  syncedAt: number;
}

// -----------------------------------------------------------
// Library Configuration
// -----------------------------------------------------------

export interface SyncQueueConfig<TPayload = unknown> {
  /** Storage adapter (AsyncStorage, MMKV, SQLite, etc.) */
  storage: StorageAdapter;

  /** Network adapter (NetInfo, etc.) */
  network: NetworkAdapter;

  /**
   * Your sync logic. Called once per item during sync.
   * Return { status: 'success' }, { status: 'failure' }, or { status: 'conflict' }.
   */
  onSync: SyncHandler<TPayload>;

  /**
   * Optional validator. Called before an item is added to the queue.
   * Rejected items are never stored.
   */
  validator?: PayloadValidator<TPayload>;

  /**
   * How to handle conflicts returned by onSync.
   * Default: 'client-wins' (re-enqueue with resolvedPayload)
   */
  conflictStrategy?: ConflictStrategy;

  /**
   * Called when a conflict occurs, regardless of strategy.
   * Use to show UI or log.
   */
  onConflict?: (item: QueueItem<TPayload>, resolution: ConflictResolution) => void;

  /** Retry configuration */
  retryPolicy?: Partial<RetryPolicy>;

  /**
   * Max parallel sync requests. Default: 5.
   */
  concurrency?: number;

  /**
   * Storage key prefix. Use different prefixes for different queues
   * in the same app. Default: '@sync-queue'
   */
  storageKey?: string;

  /** Called after any item syncs successfully */
  onSuccess?: (item: QueueItem<TPayload>) => void;

  /** Called after any item permanently fails */
  onFailure?: (item: QueueItem<TPayload>, error: string) => void;
}

export interface ResolvedConfig<TPayload> extends SyncQueueConfig<TPayload> {
  concurrency: number;
  storageKey: string;
  conflictStrategy: ConflictStrategy;
  retryPolicy: RetryPolicy;
}
