// ============================================================
// __tests__/SyncQueue.test.ts
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncQueue, ValidationError } from '../src/core/SyncQueue';
import { MemoryNetworkAdapter } from '../src/adapters/NetworkAdapters';
import type { SyncQueueConfig, SyncOutcome } from '../src/types';

// -----------------------------------------------------------
// Helpers
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

type Payload = { name: string; value: number };

function makeConfig(
  overrides: Partial<SyncQueueConfig<Payload>> = {}
): SyncQueueConfig<Payload> {
  return {
    storage: makeMemoryStorage(),
    network: new MemoryNetworkAdapter(false),
    onSync: async () => ({ status: 'success' }),
    storageKey: '@test/queue',
    retryPolicy: { maxAttempts: 3, delayMs: () => 0, retryOnReconnect: false },
    ...overrides,
  };
}

// -----------------------------------------------------------
// SyncQueue — enqueue
// -----------------------------------------------------------
describe('SyncQueue.add()', () => {
  let queue: SyncQueue<Payload>;

  beforeEach(() => { queue = new SyncQueue(makeConfig()); });
  afterEach(() => { queue.destroy(); });

  it('stores item with status pending', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    const items = await queue.getAll();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('pending');
  });

  it('generates a unique id per item', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });
    const items = await queue.getAll();
    expect(items[0].id).not.toBe(items[1].id);
  });

  it('stores meta alongside payload', async () => {
    await queue.add({ payload: { name: 'A', value: 1 }, meta: { tag: 'urgent' } });
    const [item] = await queue.getAll();
    expect(item.meta?.tag).toBe('urgent');
  });

  it('starts attemptCount at 0', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    const [item] = await queue.getAll();
    expect(item.attemptCount).toBe(0);
  });

  it('throws ValidationError when validator rejects', async () => {
    queue = new SyncQueue(makeConfig({
      validator: (p) => {
        const payload = p as Payload;
        return payload.value > 0
          ? { valid: true }
          : { valid: false, errors: ['value must be positive'] };
      },
    }));

    await expect(
      queue.add({ payload: { name: 'Bad', value: -1 } })
    ).rejects.toThrow(ValidationError);
  });

  it('does not store item when validation fails', async () => {
    queue = new SyncQueue(makeConfig({
      validator: () => ({ valid: false, errors: ['bad'] }),
    }));

    try { await queue.add({ payload: { name: 'X', value: 0 } }); } catch {}
    expect(await queue.getAll()).toHaveLength(0);
  });

  it('accepts item when validator passes', async () => {
    queue = new SyncQueue(makeConfig({
      validator: () => ({ valid: true }),
    }));
    await queue.add({ payload: { name: 'OK', value: 5 } });
    expect(await queue.getAll()).toHaveLength(1);
  });
});

// -----------------------------------------------------------
// SyncQueue — syncAll
// -----------------------------------------------------------
describe('SyncQueue.syncAll()', () => {
  let queue: SyncQueue<Payload>;
  let network: MemoryNetworkAdapter;

  beforeEach(() => {
    network = new MemoryNetworkAdapter(false);
    queue = new SyncQueue(makeConfig({ network }));
  });
  afterEach(() => { queue.destroy(); });

  it('returns empty result when queue is empty', async () => {
    const result = await queue.syncAll();
    expect(result.total).toBe(0);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('removes item from queue on success', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();
    expect(await queue.getAll()).toHaveLength(0);
  });

  it('calls onSync with correct item', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(
      async () => ({ status: 'success' })
    );
    queue = new SyncQueue(makeConfig({ network, onSync }));
    await queue.add({ payload: { name: 'Form', value: 42 } });
    await queue.syncAll();
    expect(onSync).toHaveBeenCalledOnce();
    expect(onSync.mock.calls[0][0].item.payload).toEqual({ name: 'Form', value: 42 });
  });

  it('calls onSuccess callback after success', async () => {
    const onSuccess = vi.fn();
    queue = new SyncQueue(makeConfig({ network, onSuccess }));
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('marks item as failed after permanent failure', async () => {
    queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => ({ status: 'failure', error: 'server down', retry: false }),
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
    }));
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    const items = await queue.getAll();
    expect(items[0].status).toBe('failed');
    expect(items[0].errorMessage).toBe('server down');
  });

  it('calls onFailure callback on permanent failure', async () => {
    const onFailure = vi.fn();
    queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => ({ status: 'failure', error: 'oops', retry: false }),
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
      onFailure,
    }));
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('syncs multiple items and reports correct counts', async () => {
    const results: SyncOutcome[] = [
      { status: 'success' },
      { status: 'failure', error: 'bad', retry: false },
      { status: 'success' },
    ];
    let call = 0;
    queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => results[call++],
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
    }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });
    await queue.add({ payload: { name: 'C', value: 3 } });

    const result = await queue.syncAll();
    expect(result.total).toBe(3);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
  });

  it('does not double-sync while already syncing', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { status: 'success' };
    });
    queue = new SyncQueue(makeConfig({ network, onSync }));
    await queue.add({ payload: { name: 'A', value: 1 } });

    // Fire two syncAll calls simultaneously
    const [r1, r2] = await Promise.all([queue.syncAll(), queue.syncAll()]);
    expect(onSync).toHaveBeenCalledOnce(); // second call no-ops
  });
});

// -----------------------------------------------------------
// SyncQueue — syncOne
// -----------------------------------------------------------
describe('SyncQueue.syncOne()', () => {
  let queue: SyncQueue<Payload>;

  beforeEach(() => { queue = new SyncQueue(makeConfig()); });
  afterEach(() => { queue.destroy(); });

  it('syncs only the targeted item', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(
      async () => ({ status: 'success' })
    );
    queue = new SyncQueue(makeConfig({ onSync }));

    const a = await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });

    await queue.syncOne(a.id);

    expect(onSync).toHaveBeenCalledOnce();
    expect(await queue.getAll()).toHaveLength(1); // B still there
  });

  it('returns empty result for unknown id', async () => {
    const result = await queue.syncOne('ghost-id');
    expect(result.total).toBe(0);
  });
});

// -----------------------------------------------------------
// SyncQueue — retry logic
// -----------------------------------------------------------
describe('SyncQueue retry', () => {
  it('retries up to maxAttempts then marks failed', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(
      async () => ({ status: 'failure', error: 'error', retry: true })
    );
    const network = new MemoryNetworkAdapter(false);
    const queue = new SyncQueue(makeConfig({
      network,
      onSync,
      retryPolicy: { maxAttempts: 3, delayMs: () => 0, retryOnReconnect: false },
    }));

    await queue.add({ payload: { name: 'A', value: 1 } });

    // Run sync 3 times to exhaust attempts
    await queue.syncAll();
    await queue.syncAll();
    await queue.syncAll();

    const items = await queue.getAll();
    expect(items[0].status).toBe('failed');
    queue.destroy();
  });

  it('increments attemptCount on each try', async () => {
    const network = new MemoryNetworkAdapter(false);
    const queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => ({ status: 'failure', error: 'err', retry: true }),
      retryPolicy: { maxAttempts: 3, delayMs: () => 0, retryOnReconnect: false },
    }));

    const item = await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    const [updated] = await queue.getAll();
    expect(updated.attemptCount).toBe(1);
    queue.destroy();
  });
});

// -----------------------------------------------------------
// SyncQueue — conflict resolution
// -----------------------------------------------------------
describe('SyncQueue conflict resolution', () => {
  let network: MemoryNetworkAdapter;

  beforeEach(() => { network = new MemoryNetworkAdapter(false); });

  it('client-wins: re-enqueues with resolvedPayload', async () => {
    const queue = new SyncQueue(makeConfig({
      network,
      conflictStrategy: 'client-wins',
      onSync: async () => ({
        status: 'conflict',
        resolution: {
          strategy: 'client-wins',
          resolvedPayload: { name: 'Resolved', value: 99 },
          reason: 'stale',
        },
      }),
    }));

    await queue.add({ payload: { name: 'Original', value: 1 } });
    await queue.syncAll();

    const items = await queue.getAll();
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ name: 'Resolved', value: 99 });
    queue.destroy();
  });

  it('server-wins: discards item', async () => {
    const queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => ({
        status: 'conflict',
        resolution: { strategy: 'server-wins' },
      }),
    }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    expect(await queue.getAll()).toHaveLength(0);
    queue.destroy();
  });

  it('manual: marks item as failed with conflict message', async () => {
    const queue = new SyncQueue(makeConfig({
      network,
      onSync: async () => ({
        status: 'conflict',
        resolution: { strategy: 'manual', reason: 'needs review' },
      }),
    }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    const [item] = await queue.getAll();
    expect(item.status).toBe('failed');
    expect(item.errorMessage).toContain('needs review');
    queue.destroy();
  });

  it('always fires onConflict callback regardless of strategy', async () => {
    const onConflict = vi.fn();
    const queue = new SyncQueue(makeConfig({
      network,
      onConflict,
      onSync: async () => ({
        status: 'conflict',
        resolution: { strategy: 'server-wins' },
      }),
    }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    expect(onConflict).toHaveBeenCalledOnce();
    queue.destroy();
  });
});

// -----------------------------------------------------------
// SyncQueue — auto-sync on reconnect
// -----------------------------------------------------------
describe('SyncQueue auto-sync on reconnect', () => {
  it('triggers syncAll when coming back online', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(
      async () => ({ status: 'success' })
    );
    const network = new MemoryNetworkAdapter(false);
    const queue = new SyncQueue(makeConfig({ network, onSync }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    expect(onSync).not.toHaveBeenCalled();

    network.setConnected(true);
    await new Promise((r) => setTimeout(r, 20));

    expect(onSync).toHaveBeenCalledOnce();
    queue.destroy();
  });

  it('does not trigger syncAll when already online and going offline', async () => {
    const onSync = vi.fn<SyncQueueConfig<Payload>['onSync']>(
      async () => ({ status: 'success' })
    );
    const network = new MemoryNetworkAdapter(true);
    const queue = new SyncQueue(makeConfig({ network, onSync }));

    await queue.add({ payload: { name: 'A', value: 1 } });
    await new Promise((r) => setTimeout(r, 20)); // let initial auto-sync fire

    const callsAfterAdd = onSync.mock.calls.length;
    network.setConnected(false); // go offline
    await new Promise((r) => setTimeout(r, 20));

    expect(onSync.mock.calls.length).toBe(callsAfterAdd); // no new calls
    queue.destroy();
  });
});

// -----------------------------------------------------------
// SyncQueue — queue management
// -----------------------------------------------------------
describe('SyncQueue queue management', () => {
  let queue: SyncQueue<Payload>;

  beforeEach(() => { queue = new SyncQueue(makeConfig()); });
  afterEach(() => { queue.destroy(); });

  it('getPending returns only pending and syncing items', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });
    const pending = await queue.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.every((i) => i.status === 'pending')).toBe(true);
  });

  it('getFailed returns only failed items', async () => {
    queue = new SyncQueue(makeConfig({
      onSync: async () => ({ status: 'failure', error: 'err', retry: false }),
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
    }));
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    const failed = await queue.getFailed();
    expect(failed).toHaveLength(1);
  });

  it('resetItem moves failed item back to pending', async () => {
    queue = new SyncQueue(makeConfig({
      onSync: async () => ({ status: 'failure', error: 'err', retry: false }),
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
    }));
    const item = await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.syncAll();

    await queue.resetItem(item.id);
    const [updated] = await queue.getAll();
    expect(updated.status).toBe('pending');
    expect(updated.errorMessage).toBeUndefined();
  });

  it('resetAllFailed resets every failed item', async () => {
    queue = new SyncQueue(makeConfig({
      onSync: async () => ({ status: 'failure', error: 'err', retry: false }),
      retryPolicy: { maxAttempts: 1, delayMs: () => 0, retryOnReconnect: false },
    }));
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });
    await queue.syncAll();

    await queue.resetAllFailed();
    const items = await queue.getAll();
    expect(items.every((i) => i.status === 'pending')).toBe(true);
  });

  it('removeItem deletes item from queue', async () => {
    const item = await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.removeItem(item.id);
    expect(await queue.getAll()).toHaveLength(0);
  });

  it('clearAll wipes the entire queue', async () => {
    await queue.add({ payload: { name: 'A', value: 1 } });
    await queue.add({ payload: { name: 'B', value: 2 } });
    await queue.clearAll();
    expect(await queue.getAll()).toHaveLength(0);
  });
});

// -----------------------------------------------------------
// SyncQueue — subscriber notifications
// -----------------------------------------------------------
describe('SyncQueue.subscribe()', () => {
  let queue: SyncQueue<Payload>;

  beforeEach(() => { queue = new SyncQueue(makeConfig()); });
  afterEach(() => { queue.destroy(); });

  it('notifies subscriber when item is added', async () => {
    const listener = vi.fn();
    queue.subscribe(listener);
    await queue.add({ payload: { name: 'A', value: 1 } });
    expect(listener).toHaveBeenCalled();
  });

  it('notifies subscriber when item is removed', async () => {
    const item = await queue.add({ payload: { name: 'A', value: 1 } });
    const listener = vi.fn();
    queue.subscribe(listener);
    await queue.removeItem(item.id);
    expect(listener).toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    unsubscribe();
    await queue.add({ payload: { name: 'A', value: 1 } });
    expect(listener).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------
// SyncQueue — concurrency
// -----------------------------------------------------------
describe('SyncQueue concurrency', () => {
  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    const onSync = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { status: 'success' } as SyncOutcome;
    });

    const network = new MemoryNetworkAdapter(false);
    const queue = new SyncQueue(makeConfig({ network, onSync, concurrency: 2 }));

    for (let i = 0; i < 6; i++) {
      await queue.add({ payload: { name: `Form${i}`, value: i } });
    }

    await queue.syncAll();

    expect(maxActive).toBeLessThanOrEqual(2);
    queue.destroy();
  });
});

// -----------------------------------------------------------
// SyncQueue — destroy
// -----------------------------------------------------------
describe('SyncQueue.destroy()', () => {
  it('clears all subscribers', async () => {
    const queue = new SyncQueue(makeConfig());
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.destroy();

    await queue.add({ payload: { name: 'A', value: 1 } });
    expect(listener).not.toHaveBeenCalled();
  });
});
