// ============================================================
// sync-queue — React Hooks
// Three hooks covering all React integration needs.
// ============================================================

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { SyncQueue } from '../core/SyncQueue';
import type {
  QueueItem,
  SyncResult,
  SyncQueueConfig,
  AddItemInput,
} from '../types';

// ----------------------------------------------------------
// useNetworkStatus
// Subscribe to connectivity state.
//
// @example
// const { isConnected } = useNetworkStatus(network);
// ----------------------------------------------------------

export function useNetworkStatus(
  network: SyncQueueConfig['network']
): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Fetch initial state
    network.isConnected().then(setIsConnected);

    // Subscribe to changes
    const unsubscribe = network.onConnectivityChange(setIsConnected);
    return unsubscribe;
  }, [network]);

  return { isConnected };
}

// ----------------------------------------------------------
// useQueue
// Subscribe to queue state from an existing SyncQueue instance.
// Use this when you create the SyncQueue outside React
// (e.g. at module level or in a service).
//
// @example
// const queue = new SyncQueue({ ... }); // created once at module level
//
// function MyScreen() {
//   const { items, pendingItems, failedItems, add, syncAll } = useQueue(queue);
// }
// ----------------------------------------------------------

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

export function useQueue<TPayload = unknown>(
  queue: SyncQueue<TPayload>
): UseQueueReturn<TPayload> {
  const [items, setItems] = useState<QueueItem<TPayload>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(queue.isConnected);
  const [lastSyncResult, setLastSyncResult] =
    useState<SyncResult<TPayload> | null>(null);

  // Refresh queue from storage whenever queue state changes
  const refresh = useCallback(async () => {
    const all = await queue.getAll();
    setItems(all);
    setIsSyncing(queue.isSyncing);
    setIsConnected(queue.isConnected);
    setIsLoading(false);
  }, [queue]);

  useEffect(() => {
    refresh();
    const unsubscribe = queue.subscribe(refresh);
    return unsubscribe;
  }, [queue, refresh]);

  const add = useCallback(
    (input: AddItemInput<TPayload>) => queue.add(input),
    [queue]
  );

  const syncAll = useCallback(async () => {
    const result = await queue.syncAll();
    setLastSyncResult(result);
    return result;
  }, [queue]);

  const syncOne = useCallback(
    async (id: string) => {
      const result = await queue.syncOne(id);
      setLastSyncResult(result);
      return result;
    },
    [queue]
  );

  const resetItem = useCallback(
    (id: string) => queue.resetItem(id),
    [queue]
  );

  const resetAllFailed = useCallback(
    () => queue.resetAllFailed(),
    [queue]
  );

  const removeItem = useCallback(
    (id: string) => queue.removeItem(id),
    [queue]
  );

  const clearAll = useCallback(() => queue.clearAll(), [queue]);

  const pendingItems = useMemo(
    () => items.filter((i) => i.status === 'pending' || i.status === 'syncing'),
    [items]
  );

  const failedItems = useMemo(
    () => items.filter((i) => i.status === 'failed'),
    [items]
  );

  return {
    items,
    pendingItems,
    failedItems,
    pendingCount: pendingItems.length,
    isLoading,
    isSyncing,
    isConnected,
    add,
    syncAll,
    syncOne,
    resetItem,
    resetAllFailed,
    removeItem,
    clearAll,
    lastSyncResult,
  };
}

// ----------------------------------------------------------
// useSyncQueue
// All-in-one hook. Creates AND manages the SyncQueue instance.
// Best for apps with a single queue — no need to manage the
// SyncQueue instance manually.
//
// @example
// function App() {
//   const { add, syncAll, pendingItems, failedItems } = useSyncQueue({
//     storage: new AsyncStorageAdapter(AsyncStorage),
//     network: new NetInfoAdapter(NetInfo),
//     onSync: async ({ item }) => {
//       const res = await fetch('/api/submit', { ... });
//       return res.ok ? { status: 'success' } : { status: 'failure', error: 'Failed' };
//     },
//   });
// }
// ----------------------------------------------------------

export function useSyncQueue<TPayload = unknown>(
  config: SyncQueueConfig<TPayload>
): UseQueueReturn<TPayload> {
  // Stable ref so config changes don't recreate the queue
  const configRef = useRef(config);
  configRef.current = config;

  const queue = useMemo(
    () =>
      new SyncQueue<TPayload>({
        ...configRef.current,
        // Wrap callbacks to always use latest config ref
        onSync: (ctx) => configRef.current.onSync(ctx),
        onSuccess: (item) => configRef.current.onSuccess?.(item),
        onFailure: (item, err) => configRef.current.onFailure?.(item, err),
        onConflict: (item, res) => configRef.current.onConflict?.(item, res),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // Intentionally created once
  );

  useEffect(() => {
    return () => queue.destroy();
  }, [queue]);

  return useQueue(queue);
}
