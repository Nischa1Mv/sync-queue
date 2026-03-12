import { SyncQueue } from '../core/SyncQueue';
import type { QueueItem, SyncResult, SyncQueueConfig, AddItemInput } from '../types';
export declare function useNetworkStatus(network: SyncQueueConfig['network']): {
    isConnected: boolean;
};
interface UseQueueReturn<TPayload> {
    /** All items in the queue */
    items: QueueItem<TPayload>[];
    /** Items with status pending or syncing */
    pendingItems: QueueItem<TPayload>[];
    /** Items with status failed */
    failedItems: QueueItem<TPayload>[];
    /** Count of pending items — for badges */
    pendingCount: number;
    /** Whether queue is loading from storage on first render */
    isLoading: boolean;
    /** Whether a sync is in progress */
    isSyncing: boolean;
    /** Whether device is online */
    isConnected: boolean;
    /** Add a new item */
    add: (input: AddItemInput<TPayload>) => Promise<QueueItem<TPayload>>;
    /** Sync all pending items */
    syncAll: () => Promise<SyncResult<TPayload>>;
    /** Sync a single item by ID */
    syncOne: (id: string) => Promise<SyncResult<TPayload>>;
    /** Reset a failed item to pending */
    resetItem: (id: string) => Promise<void>;
    /** Reset all failed items to pending */
    resetAllFailed: () => Promise<void>;
    /** Remove an item */
    removeItem: (id: string) => Promise<void>;
    /** Wipe all items (e.g. on logout) */
    clearAll: () => Promise<void>;
    /** Result of the last sync */
    lastSyncResult: SyncResult<TPayload> | null;
}
export declare function useQueue<TPayload = unknown>(queue: SyncQueue<TPayload>): UseQueueReturn<TPayload>;
export declare function useSyncQueue<TPayload = unknown>(config: SyncQueueConfig<TPayload>): UseQueueReturn<TPayload>;
export {};
//# sourceMappingURL=index.d.ts.map