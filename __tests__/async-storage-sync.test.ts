import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStorageSync } from '../src';

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
    const found = await store.getById<{ amount: number }>('invoices', saved._id);

    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(99);
    expect(found?._id).toBe(saved._id);
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
    expect(all[0].amount).toBe(20);
  });

  it('flush marks queue item synced when server returns 200', async () => {
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
    await store.flush();

    const refreshed = await store.getById<{ amount: number }>('invoices', record._id);
    expect(refreshed?._synced).toBe('synced');
    expect(store.getQueue()[0]?.synced).toBe(true);

    vi.unstubAllGlobals();
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
    await store.flush();

    const deleted = await store.getById<{ amount: number }>('invoices', record._id);
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
    await store.flush();

    const failed = await store.getById<{ amount: number }>('invoices', record._id);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError).toHaveBeenCalledWith(401, expect.objectContaining({ recordId: record._id }));
    expect(failed?._synced).toBe('failed');
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

    await store.syncById('invoices', second._id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body._id).toBe(second._id);

    const firstAfter = await store.getById<{ amount: number }>('invoices', first._id);
    const secondAfter = await store.getById<{ amount: number }>('invoices', second._id);
    expect(firstAfter?._synced).toBe('pending');
    expect(secondAfter?._synced).toBe('synced');
  });

  it('sync(collection) only sends queued items for that collection', async () => {
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

    await store.sync('invoices');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body._id).toBe(invoice._id);
    expect(body.amount).toBe(100);

    const invoiceAfter = await store.getById<{ amount: number }>('invoices', invoice._id);
    const receiptAfter = await store.getById<{ amount: number }>('receipts', receipt._id);
    expect(invoiceAfter?._synced).toBe('synced');
    expect(receiptAfter?._synced).toBe('pending');
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
    await store.flush();

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
    await store.flush();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('custom-key');
    expect(headers.Authorization).toBe('Token abc123');
  });
});
