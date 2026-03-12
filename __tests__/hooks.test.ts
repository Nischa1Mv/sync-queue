// ============================================================
// __tests__/hooks.test.ts
// Tests for useQueue and useSyncQueue
// ============================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useQueue, useSyncQueue } from '../src/hooks';
import { SyncQueue } from '../src/core/SyncQueue';
import { MemoryNetworkAdapter } from '../src/adapters/NetworkAdapters';
import type { SyncQueueConfig, SyncOutcome } from '../src/types';

// -----------------------------------------------------------
// Shared test helpers
// -----------------------------------------------------------

function makeMemoryStorage() {
  const store = new Map<string, string>();
  return {
    async getItem<T>(key: string) {
      const raw = store.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async setItem<T>(key: string, value: T) {
      store.set(key, JSON.stringify(value));
    },
    async removeItem(key: string) {
      store.delete(key);
    },
  };
}

type TestPayload = { formName: string; value: number };

function makeConfig(
  overrides: Partial<SyncQueueConfig<TestPayload>> = {}
): SyncQueueConfig<TestPayload> {
  return {
    storage: makeMemoryStorage(),
    network: new MemoryNetworkAdapter(false), // starts offline
    onSync: async () => ({ status: 'success' }),
    storageKey: '@test/queue',
    ...overrides,
  };
}

// -----------------------------------------------------------
// useQueue
// -----------------------------------------------------------
describe('useQueue', () => {
  let queue: SyncQueue<TestPayload>;
  let network: MemoryNetworkAdapter;

  beforeEach(() => {
    network = new MemoryNetworkAdapter(false);
    queue = new SyncQueue(makeConfig({ network }));
  });

  afterEach(() => {
    queue.destroy();
  });

  // --------------------------------------------------------
  // Initial state
  // --------------------------------------------------------
  describe('initial state', () => {
    it('starts with empty items and isLoading true', () => {
      const { result } = renderHook(() => useQueue(queue));
      expect(result.current.items).toEqual([]);
      expect(result.current.isLoading).toBe(true);
    });

    it('resolves to loaded state after mount', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isLoading).toBe(false);
    });

    it('reflects network state', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isConnected).toBe(false);
    });
  });

  // --------------------------------------------------------
  // add
  // --------------------------------------------------------
  describe('add()', () => {
    it('adds an item and updates queue state', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'Test', value: 1 } });
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].payload.formName).toBe('Test');
    });

    it('increments pendingCount', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'A', value: 1 } });
        await result.current.add({ payload: { formName: 'B', value: 2 } });
      });

      expect(result.current.pendingCount).toBe(2);
    });

    it('new item appears in pendingItems', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'Form', value: 42 } });
      });

      expect(result.current.pendingItems).toHaveLength(1);
      expect(result.current.failedItems).toHaveLength(0);
    });

    it('attaches meta to item', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({
          payload: { formName: 'Form', value: 1 },
          meta: { userId: 'u-123', tag: 'urgent' },
        });
      });

      expect(result.current.items[0].meta).toEqual({ userId: 'u-123', tag: 'urgent' });
    });
  });

  // --------------------------------------------------------
  // removeItem
  // --------------------------------------------------------
  describe('removeItem()', () => {
    it('removes item from queue', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let addedId: string;
      await act(async () => {
        const item = await result.current.add({ payload: { formName: 'X', value: 0 } });
        addedId = item.id;
      });

      await act(async () => {
        await result.current.removeItem(addedId);
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('only removes the targeted item', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let idA: string;
      await act(async () => {
        const a = await result.current.add({ payload: { formName: 'A', value: 1 } });
        await result.current.add({ payload: { formName: 'B', value: 2 } });
        idA = a.id;
      });

      await act(async () => {
        await result.current.removeItem(idA);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].payload.formName).toBe('B');
    });
  });

  // --------------------------------------------------------
  // clearAll
  // --------------------------------------------------------
  describe('clearAll()', () => {
    it('wipes all items from state', async () => {
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'A', value: 1 } });
        await result.current.add({ payload: { formName: 'B', value: 2 } });
      });

      await act(async () => {
        await result.current.clearAll();
      });

      expect(result.current.items).toHaveLength(0);
      expect(result.current.pendingCount).toBe(0);
    });
  });

  // --------------------------------------------------------
  // resetItem
  // --------------------------------------------------------
  describe('resetItem()', () => {
    it('resets a failed item back to pending', async () => {
      // Seed a failed item directly via QueueStore
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let itemId: string;
      await act(async () => {
        const item = await result.current.add({ payload: { formName: 'F', value: 0 } });
        itemId = item.id;
      });

      // Force it to failed state
      await act(async () => {
        await queue['store'].update(itemId, { status: 'failed', errorMessage: 'oops' });
        queue['_notifyListeners']();
      });

      expect(result.current.failedItems).toHaveLength(1);

      await act(async () => {
        await result.current.resetItem(itemId);
      });

      expect(result.current.failedItems).toHaveLength(0);
      expect(result.current.pendingItems).toHaveLength(1);
    });
  });

  // --------------------------------------------------------
  // syncAll
  // --------------------------------------------------------
  describe('syncAll()', () => {
    it('returns a SyncResult', async () => {
      queue = new SyncQueue(
        makeConfig({
          network,
          onSync: async () => ({ status: 'success' }),
        })
      );
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'F', value: 1 } });
      });

      let syncResult: Awaited<ReturnType<typeof result.current.syncAll>>;
      await act(async () => {
        syncResult = await result.current.syncAll();
      });

      expect(syncResult!.total).toBe(1);
      expect(syncResult!.succeeded).toHaveLength(1);
      expect(result.current.lastSyncResult).not.toBeNull();
    });

    it('removes succeeded items from queue', async () => {
      queue = new SyncQueue(
        makeConfig({
          network,
          onSync: async () => ({ status: 'success' }),
        })
      );
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'F', value: 1 } });
      });

      await act(async () => {
        await result.current.syncAll();
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('keeps failed items in queue', async () => {
      queue = new SyncQueue(
        makeConfig({
          network,
          onSync: async () => ({ status: 'failure', error: 'server error', retry: false }),
          retryPolicy: { maxAttempts: 1 },
        })
      );
      const { result } = renderHook(() => useQueue(queue));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.add({ payload: { formName: 'F', value: 1 } });
      });

      await act(async () => {
        await result.current.syncAll();
      });

      expect(result.current.failedItems).toHaveLength(1);
      expect(result.current.failedItems[0].errorMessage).toBe('server error');
    });
  });

  // --------------------------------------------------------
  // isConnected reactivity
  // --------------------------------------------------------
  describe('isConnected', () => {
    it('updates when network changes', async () => {
      const { result } = renderHook(() => useQueue(queue));

      // Wait for initial async call to resolve
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(false);

      act(() => network.setConnected(true));
      // Wait for the callback to propagate
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(true);
    });
  });
});

// -----------------------------------------------------------
// useSyncQueue
// -----------------------------------------------------------
describe('useSyncQueue', () => {
  // --------------------------------------------------------
  // Bootstrap
  // --------------------------------------------------------
  it('initialises and loads queue on mount', async () => {
    const { result } = renderHook(() =>
      useSyncQueue(makeConfig())
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  // --------------------------------------------------------
  // add + auto-sync when online
  // --------------------------------------------------------
  it('auto-syncs when item added while online', async () => {
    const onSync = vi.fn<() => Promise<SyncOutcome>>(
      async () => ({ status: 'success' })
    );
    const network = new MemoryNetworkAdapter(true); // starts online

    const { result } = renderHook(() =>
      useSyncQueue(makeConfig({ network, onSync }))
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.add({ payload: { formName: 'Auto', value: 1 } });
      // Wait for the deferred auto-sync to fire
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onSync).toHaveBeenCalledOnce();
    expect(result.current.items).toHaveLength(0); // removed after success
  });

  it('does not auto-sync when item added while offline', async () => {
    const onSync = vi.fn<() => Promise<SyncOutcome>>(
      async () => ({ status: 'success' })
    );
    const network = new MemoryNetworkAdapter(false); // offline

    const { result } = renderHook(() =>
      useSyncQueue(makeConfig({ network, onSync }))
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.add({ payload: { formName: 'Queued', value: 1 } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onSync).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
  });

  // --------------------------------------------------------
  // Auto-sync on reconnect
  // --------------------------------------------------------
  it('auto-syncs pending items when coming back online', async () => {
    const onSync = vi.fn<() => Promise<SyncOutcome>>(
      async () => ({ status: 'success' })
    );
    const network = new MemoryNetworkAdapter(false);

    const { result } = renderHook(() =>
      useSyncQueue(makeConfig({ network, onSync }))
    );
    await act(async () => {
      await Promise.resolve();
    });

    // Add while offline
    await act(async () => {
      await result.current.add({ payload: { formName: 'Pending', value: 1 } });
    });

    expect(onSync).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);

    // Come back online — should trigger auto-sync
    await act(async () => {
      network.setConnected(true);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onSync).toHaveBeenCalledOnce();
    expect(result.current.items).toHaveLength(0);
  });

  // --------------------------------------------------------
  // Validation
  // --------------------------------------------------------
  it('throws ValidationError when validator rejects payload', async () => {
    const { result } = renderHook(() =>
      useSyncQueue(
        makeConfig({
          validator: (p: unknown) => {
            const payload = p as TestPayload;
            return payload.value > 0
              ? { valid: true }
              : { valid: false, errors: ['value must be positive'] };
          },
        })
      )
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.add({ payload: { formName: 'Bad', value: -1 } });
      })
    ).rejects.toThrow('value must be positive');

    expect(result.current.items).toHaveLength(0);
  });

  // --------------------------------------------------------
  // Conflict resolution
  // --------------------------------------------------------
  it('calls onConflict and re-enqueues on client-wins', async () => {
    const onConflict = vi.fn();
    const network = new MemoryNetworkAdapter(false);

    const { result } = renderHook(() =>
      useSyncQueue(
        makeConfig({
          network,
          conflictStrategy: 'client-wins',
          onConflict,
          onSync: async () => ({
            status: 'conflict',
            resolution: {
              strategy: 'client-wins',
              resolvedPayload: { formName: 'Resolved', value: 99 },
              reason: 'Stale data',
            },
          }),
        })
      )
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.add({ payload: { formName: 'Original', value: 1 } });
    });

    await act(async () => {
      await result.current.syncAll();
    });

    expect(onConflict).toHaveBeenCalledOnce();
    // Re-enqueued with resolved payload
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].payload).toEqual({ formName: 'Resolved', value: 99 });
  });

  it('discards item on server-wins conflict', async () => {
    const network = new MemoryNetworkAdapter(false);

    const { result } = renderHook(() =>
      useSyncQueue(
        makeConfig({
          network,
          onSync: async () => ({
            status: 'conflict',
            resolution: { strategy: 'server-wins' },
          }),
        })
      )
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.add({ payload: { formName: 'Discard', value: 1 } });
    });

    await act(async () => {
      await result.current.syncAll();
    });

    expect(result.current.items).toHaveLength(0);
  });

  // --------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------
  it('destroys the queue on unmount', async () => {
    const destroySpy = vi.spyOn(SyncQueue.prototype, 'destroy');

    const { result, unmount } = renderHook(() =>
      useSyncQueue(makeConfig())
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    unmount();

    expect(destroySpy).toHaveBeenCalledOnce();
    destroySpy.mockRestore();
  });
});
