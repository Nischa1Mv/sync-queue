// ============================================================
// __tests__/QueueStore.test.ts
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { QueueStore } from '../src/core/QueueStore';
import type { QueueItem } from '../src/types';

// -----------------------------------------------------------
// In-memory storage adapter (no AsyncStorage needed)
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

// -----------------------------------------------------------
// Helper: build a minimal QueueItem
// -----------------------------------------------------------
function makeItem(
  overrides: Partial<QueueItem<{ name: string }>> = {}
): QueueItem<{ name: string }> {
  return {
    id: `item-${Math.random().toString(36).slice(2, 7)}`,
    payload: { name: 'Test Form' },
    status: 'pending',
    createdAt: Date.now(),
    attemptCount: 0,
    ...overrides,
  };
}

// -----------------------------------------------------------
// Tests
// -----------------------------------------------------------
describe('QueueStore', () => {
  let store: QueueStore<{ name: string }>;

  beforeEach(() => {
    // Fresh in-memory storage before every test
    store = new QueueStore(makeMemoryStorage(), '@test/queue');
  });

  // --------------------------------------------------------
  // getAll
  // --------------------------------------------------------
  describe('getAll()', () => {
    it('returns empty array when storage is empty', async () => {
      const items = await store.getAll();
      expect(items).toEqual([]);
    });

    it('returns all stored items', async () => {
      const a = makeItem();
      const b = makeItem();
      await store.add(a);
      await store.add(b);

      const items = await store.getAll();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.id)).toContain(a.id);
      expect(items.map((i) => i.id)).toContain(b.id);
    });
  });

  // --------------------------------------------------------
  // add
  // --------------------------------------------------------
  describe('add()', () => {
    it('persists an item', async () => {
      const item = makeItem();
      await store.add(item);

      const items = await store.getAll();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(item.id);
    });

    it('appends without overwriting existing items', async () => {
      await store.add(makeItem());
      await store.add(makeItem());
      await store.add(makeItem());

      expect(await store.count()).toBe(3);
    });

    it('preserves the full payload', async () => {
      const item = makeItem({ payload: { name: 'Customer Form' } });
      await store.add(item);

      const [stored] = await store.getAll();
      expect(stored.payload).toEqual({ name: 'Customer Form' });
    });
  });

  // --------------------------------------------------------
  // getById
  // --------------------------------------------------------
  describe('getById()', () => {
    it('returns the correct item', async () => {
      const target = makeItem();
      await store.add(makeItem());
      await store.add(target);

      const found = await store.getById(target.id);
      expect(found?.id).toBe(target.id);
    });

    it('returns null for unknown id', async () => {
      await store.add(makeItem());
      const found = await store.getById('does-not-exist');
      expect(found).toBeNull();
    });
  });

  // --------------------------------------------------------
  // getByStatus
  // --------------------------------------------------------
  describe('getByStatus()', () => {
    it('filters by single status', async () => {
      await store.add(makeItem({ status: 'pending' }));
      await store.add(makeItem({ status: 'failed' }));
      await store.add(makeItem({ status: 'pending' }));

      const pending = await store.getByStatus('pending');
      expect(pending).toHaveLength(2);
      expect(pending.every((i) => i.status === 'pending')).toBe(true);
    });

    it('filters by multiple statuses', async () => {
      await store.add(makeItem({ status: 'pending' }));
      await store.add(makeItem({ status: 'failed' }));
      await store.add(makeItem({ status: 'syncing' }));

      const active = await store.getByStatus('pending', 'syncing');
      expect(active).toHaveLength(2);
    });

    it('returns empty array when no items match', async () => {
      await store.add(makeItem({ status: 'pending' }));
      const failed = await store.getByStatus('failed');
      expect(failed).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // update
  // --------------------------------------------------------
  describe('update()', () => {
    it('updates only the specified fields', async () => {
      const item = makeItem({ status: 'pending', attemptCount: 0 });
      await store.add(item);

      await store.update(item.id, { status: 'failed', errorMessage: 'timeout' });

      const updated = await store.getById(item.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.errorMessage).toBe('timeout');
      // untouched fields preserved
      expect(updated?.payload).toEqual(item.payload);
      expect(updated?.createdAt).toBe(item.createdAt);
    });

    it('does nothing for unknown id', async () => {
      const item = makeItem();
      await store.add(item);

      await store.update('ghost-id', { status: 'failed' });

      const items = await store.getAll();
      expect(items[0].status).toBe('pending'); // unchanged
    });

    it('can increment attemptCount', async () => {
      const item = makeItem({ attemptCount: 1 });
      await store.add(item);

      await store.update(item.id, { attemptCount: 2, attemptedAt: Date.now() });

      const updated = await store.getById(item.id);
      expect(updated?.attemptCount).toBe(2);
      expect(updated?.attemptedAt).toBeDefined();
    });
  });

  // --------------------------------------------------------
  // remove
  // --------------------------------------------------------
  describe('remove()', () => {
    it('removes the correct item', async () => {
      const a = makeItem();
      const b = makeItem();
      await store.add(a);
      await store.add(b);

      await store.remove(a.id);

      const items = await store.getAll();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(b.id);
    });

    it('is a no-op for unknown id', async () => {
      await store.add(makeItem());
      await store.remove('ghost-id');
      expect(await store.count()).toBe(1);
    });
  });

  // --------------------------------------------------------
  // clear
  // --------------------------------------------------------
  describe('clear()', () => {
    it('wipes all items', async () => {
      await store.add(makeItem());
      await store.add(makeItem());
      await store.clear();

      expect(await store.getAll()).toEqual([]);
    });

    it('is safe to call on an empty store', async () => {
      await expect(store.clear()).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------
  // count / countByStatus
  // --------------------------------------------------------
  describe('count()', () => {
    it('returns 0 for empty store', async () => {
      expect(await store.count()).toBe(0);
    });

    it('returns total item count', async () => {
      await store.add(makeItem());
      await store.add(makeItem());
      expect(await store.count()).toBe(2);
    });
  });

  describe('countByStatus()', () => {
    it('counts items matching given status', async () => {
      await store.add(makeItem({ status: 'pending' }));
      await store.add(makeItem({ status: 'pending' }));
      await store.add(makeItem({ status: 'failed' }));

      expect(await store.countByStatus('pending')).toBe(2);
      expect(await store.countByStatus('failed')).toBe(1);
      expect(await store.countByStatus('syncing')).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Storage key isolation
  // --------------------------------------------------------
  describe('storage key isolation', () => {
    it('two stores with different keys do not share data', async () => {
      const storage = makeMemoryStorage();
      const storeA = new QueueStore(storage, '@app/queue-a');
      const storeB = new QueueStore(storage, '@app/queue-b');

      await storeA.add(makeItem());

      expect(await storeA.count()).toBe(1);
      expect(await storeB.count()).toBe(0);
    });
  });
});
