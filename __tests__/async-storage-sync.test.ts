import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStorageSync, ensureInitialized, isInitialized } from '../src';

type MemStore = Map<string, string>;

const memoryStorage = {
  data: new Map<string, string>() as MemStore,
  getItem: vi.fn(async (key: string) => memoryStorage.data.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    memoryStorage.data.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    memoryStorage.data.delete(key);
  }),
  getAllKeys: vi.fn(async () => Array.from(memoryStorage.data.keys())),
  clear: vi.fn(async () => {
    memoryStorage.data.clear();
  }),
};

describe('AsyncStorageSync', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    memoryStorage.data.clear();
    (globalThis as { __ASYNC_STORAGE__?: typeof memoryStorage }).__ASYNC_STORAGE__ = memoryStorage;

    try {
      const instance = AsyncStorageSync.getInstance();
      await instance.destroy();
    } catch {
      // not initialized yet
    }
  });

  it('throws if getInstance() is called before init()', () => {
    expect(() => AsyncStorageSync.getInstance()).toThrow();
  });

  it('exposes initialization state', async () => {
    expect(isInitialized()).toBe(false);

    await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
    });

    expect(isInitialized()).toBe(true);
  });

  it('ensureInitialized throws without config when not initialized', async () => {
    await expect(ensureInitialized()).rejects.toThrow('Queue is not initialized');
  });

  it('ensureInitialized initializes when config is provided', async () => {
    const store = await ensureInitialized({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
    });

    const same = await ensureInitialized();
    expect(store).toBe(same);
  });

  it('syncOnSave triggers debounced best-effort flush after save', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
      }));
      vi.stubGlobal('fetch', fetchMock);

      const store = await AsyncStorageSync.init({
        driver: 'asyncstorage',
        serverUrl: 'https://api.example.com',
        credentials: { apiKey: 'k' },
        autoSync: false,
        syncOnSave: true,
        onSyncSuccess: 'keep',
      });

      await store.save('invoices', { amount: 111 });
      expect(fetchMock).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(600);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('does not flush on save by default', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
      }));
      vi.stubGlobal('fetch', fetchMock);

      const store = await AsyncStorageSync.init({
        driver: 'asyncstorage',
        serverUrl: 'https://api.example.com',
        credentials: { apiKey: 'k' },
        autoSync: false,
        onSyncSuccess: 'keep',
      });

      await store.save('invoices', { amount: 222 });
      await vi.advanceTimersByTimeAsync(600);
      expect(fetchMock).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('returns same singleton instance after init()', async () => {
    const first = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
    });
    const second = AsyncStorageSync.getInstance();

    expect(first).toBe(second);
  });

  it('saves and reads collection records', async () => {
    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
    });

    const saved = await store.save('invoices', { amount: 99 });
    const all = await store.getAll<{ amount: number }>('invoices');
    const found = await store.getById<{ amount: number }>('invoices', saved.meta.id);

    expect(all).toHaveLength(1);
    expect(all[0].data.amount).toBe(99);
    expect(found?.meta.id).toBe(saved.meta.id);
    expect(store.getQueue()).toHaveLength(1);
  });

  it('overwrites by _type when duplicateStrategy is overwrite', async () => {
    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      duplicateStrategy: 'overwrite',
    });

    await store.save('invoices', { amount: 10 }, { type: 'invoice' });
    await store.save('invoices', { amount: 20 }, { type: 'invoice' });

    const all = await store.getAll<{ amount: number }>('invoices');
    expect(all).toHaveLength(1);
    expect(all[0].data.amount).toBe(20);
  });

  it('flushWithResult marks queue item synced when server returns 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
      }))
    );

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'keep',
    });

    const record = await store.save('invoices', { amount: 11 });
    await store.flushWithResult();

    const refreshed = await store.getById<{ amount: number }>('invoices', record.meta.id);
    expect(refreshed?.meta.synced).toBe('synced');
    expect(store.getQueue()[0]?.synced).toBe(true);

    vi.unstubAllGlobals();
  });

  it('flushWithResult returns sync summary counts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'keep',
    });

    await store.save('invoices', { amount: 11 });
    await store.save('invoices', { amount: 22 });
    await store.save('invoices', { amount: 33 });

    const result = await store.flushWithResult();

    expect(result.skippedAlreadyFlushing).toBe(false);
    expect(result.attempted).toBe(3);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.networkErrors).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.remainingPending).toBe(1);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.status).sort()).toEqual(['failed', 'retried', 'synced']);
  });

  it('removes record after successful sync when onSyncSuccess is delete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
      }))
    );

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'delete',
    });

    const record = await store.save('invoices', { amount: 50 });
    await store.flushWithResult();

    const deleted = await store.getById<{ amount: number }>('invoices', record.meta.id);
    expect(deleted).toBeNull();
    expect(store.getQueue()[0]?.synced).toBe(true);
  });

  it('fires onAuthError for 401 and marks record as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
      }))
    );

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
    });

    const onAuthError = vi.fn();
    store.onAuthError(onAuthError);

    const record = await store.save('invoices', { amount: 70 });
    await store.flushWithResult();

    const failed = await store.getById<{ amount: number }>('invoices', record.meta.id);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError).toHaveBeenCalledWith(401, expect.objectContaining({ recordId: record.meta.id }));
    expect(failed?.meta.synced).toBe('failed');
    expect(store.getQueue()).toHaveLength(0);
  });

  it('syncById only syncs the targeted record', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'keep',
    });

    const first = await store.save('invoices', { amount: 10 });
    const second = await store.save('invoices', { amount: 20 });

    await store.syncById('invoices', second.meta.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.amount).toBe(second.data.amount);

    const firstAfter = await store.getById<{ amount: number }>('invoices', first.meta.id);
    const secondAfter = await store.getById<{ amount: number }>('invoices', second.meta.id);
    expect(firstAfter?.meta.synced).toBe('pending');
    expect(secondAfter?.meta.synced).toBe('synced');
  });

  it('syncWithResult(collection) only sends queued items for that collection', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'keep',
    });

    const invoice = await store.save('invoices', { amount: 100 });
    const receipt = await store.save('receipts', { amount: 30 });

    const result = await store.syncWithResult('invoices');

    expect(result.attempted).toBe(1);
    expect(result.synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.amount).toBe(invoice.data.amount);
    expect(body.amount).toBe(100);

    const invoiceAfter = await store.getById<{ amount: number }>('invoices', invoice.meta.id);
    const receiptAfter = await store.getById<{ amount: number }>('receipts', receipt.meta.id);
    expect(invoiceAfter?.meta.synced).toBe('synced');
    expect(receiptAfter?.meta.synced).toBe('pending');
  });

  it('syncManyWithResult(collections) only sends queued items for selected collections', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'k' },
      onSyncSuccess: 'keep',
    });

    const invoice = await store.save('invoices', { amount: 100 });
    const receipt = await store.save('receipts', { amount: 30 });
    const order = await store.save('orders', { amount: 40 });

    const result = await store.syncManyWithResult(['invoices', 'orders']);

    expect(result.attempted).toBe(2);
    expect(result.synced).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentAmounts = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).amount).sort();
    expect(sentAmounts).toEqual([invoice.data.amount, order.data.amount].sort());

    const invoiceAfter = await store.getById<{ amount: number }>('invoices', invoice.meta.id);
    const receiptAfter = await store.getById<{ amount: number }>('receipts', receipt.meta.id);
    const orderAfter = await store.getById<{ amount: number }>('orders', order.meta.id);
    expect(invoiceAfter?.meta.synced).toBe('synced');
    expect(orderAfter?.meta.synced).toBe('synced');
    expect(receiptAfter?.meta.synced).toBe('pending');
  });

  it('maps apiKey credential to Authorization header for backward compatibility', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'legacy-key' },
      onSyncSuccess: 'keep',
    });

    await store.save('invoices', { amount: 9 });
    await store.flushWithResult();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer legacy-key');
    expect(headers.apiKey).toBeUndefined();
  });

  it('sends custom credential key-value pairs as request headers', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const store = await AsyncStorageSync.init({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: {
        'x-api-key': 'custom-key',
        Authorization: 'Token abc123',
      },
      onSyncSuccess: 'keep',
    });

    await store.save('invoices', { amount: 12 });
    await store.flushWithResult();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('custom-key');
    expect(headers.Authorization).toBe('Token abc123');
  });
});
