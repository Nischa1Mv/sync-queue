import type { SyncQueueConfig, QueueItem, AddItemInput, SyncResult } from '../types';
export declare class SyncQueue<TPayload = unknown> {
    private readonly store;
    private readonly config;
    private _isSyncing;
    private _isConnected;
    private _unsubscribeNetwork;
    private _listeners;
    constructor(config: SyncQueueConfig<TPayload>);
    /**
     * Adds an item to the queue.
     * Validates payload if a validator is configured.
     * Triggers auto-sync if currently connected.
     *
     * @throws ValidationError if payload fails validation
     */
    add(input: AddItemInput<TPayload>): Promise<QueueItem<TPayload>>;
    /**
     * Returns all items in the queue.
     */
    getAll(): Promise<QueueItem<TPayload>[]>;
    /**
     * Returns only pending + syncing items.
     */
    getPending(): Promise<QueueItem<TPayload>[]>;
    /**
     * Returns failed items.
     */
    getFailed(): Promise<QueueItem<TPayload>[]>;
    /**
     * Resets a failed item to pending for manual retry.
     */
    resetItem(id: string): Promise<void>;
    /**
     * Resets ALL failed items to pending.
     */
    resetAllFailed(): Promise<void>;
    /**
     * Removes a specific item from the queue.
     */
    removeItem(id: string): Promise<void>;
    /**
     * Wipes the entire queue. Use on logout.
     */
    clearAll(): Promise<void>;
    /**
     * Syncs all pending (and retryable failed) items.
     * Safe to call while already syncing — will no-op.
     */
    syncAll(): Promise<SyncResult<TPayload>>;
    /**
     * Syncs a single item by ID.
     */
    syncOne(id: string): Promise<SyncResult<TPayload>>;
    /**
     * Whether a sync is currently in progress.
     */
    get isSyncing(): boolean;
    /**
     * Whether the device is currently connected.
     */
    get isConnected(): boolean;
    /**
     * Subscribe to any queue state change (add, remove, status update).
     * @returns unsubscribe function
     */
    subscribe(listener: () => void): () => void;
    /**
     * Unsubscribe from network listener. Call when the queue is no longer needed.
     */
    destroy(): void;
    private _startNetworkListener;
    private _runSync;
    private _processItem;
    private _applyOutcome;
    private _resolveConflict;
    private _emptyResult;
    private _notifyListeners;
}
export declare class ValidationError extends Error {
    readonly errors: string[];
    constructor(errors: string[]);
}
//# sourceMappingURL=SyncQueue.d.ts.map