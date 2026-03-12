// ============================================================
// __tests__/adapters.test.ts
// Tests for AsyncStorageAdapter and MMKVAdapter
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AsyncStorageAdapter } from '../src/adapters/AsyncStorageAdapter';
import { MMKVAdapter } from '../src/adapters/MMKVAdapter';
import { MemoryNetworkAdapter } from '../src/adapters/NetworkAdapters';

// -----------------------------------------------------------
// Fake AsyncStorage (mirrors the real API shape)
// -----------------------------------------------------------
function makeFakeAsyncStorage() {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

// -----------------------------------------------------------
// Fake MMKV (mirrors the real API shape)
// -----------------------------------------------------------
function makeFakeMMKV() {
  const store = new Map<string, string>();
  return {
    getString(key: string) { return store.get(key); },
    set(key: string, value: string) { store.set(key, value); },
    delete(key: string) { store.delete(key); },
  };
}

// -----------------------------------------------------------
// Shared contract tests — both adapters must pass these
// -----------------------------------------------------------
function runStorageContractTests(
  label: string,
  makeAdapter: () => AsyncStorageAdapter | MMKVAdapter
) {
  describe(`${label} — storage contract`, () => {
    let adapter: AsyncStorageAdapter | MMKVAdapter;

    beforeEach(() => { adapter = makeAdapter(); });

    it('returns null for a key that does not exist', async () => {
      const result = await adapter.getItem('missing');
      expect(result).toBeNull();
    });

    it('stores and retrieves a string value', async () => {
      await adapter.setItem('key', 'hello');
      expect(await adapter.getItem('key')).toBe('hello');
    });

    it('stores and retrieves a number', async () => {
      await adapter.setItem('num', 42);
      expect(await adapter.getItem('num')).toBe(42);
    });

    it('stores and retrieves an object', async () => {
      const obj = { id: '1', name: 'Form', nested: { value: true } };
      await adapter.setItem('obj', obj);
      expect(await adapter.getItem('obj')).toEqual(obj);
    });

    it('stores and retrieves an array', async () => {
      const arr = [1, 'two', { three: 3 }];
      await adapter.setItem('arr', arr);
      expect(await adapter.getItem('arr')).toEqual(arr);
    });

    it('overwrites an existing value', async () => {
      await adapter.setItem('key', 'first');
      await adapter.setItem('key', 'second');
      expect(await adapter.getItem('key')).toBe('second');
    });

    it('removes a key', async () => {
      await adapter.setItem('key', 'value');
      await adapter.removeItem('key');
      expect(await adapter.getItem('key')).toBeNull();
    });

    it('removeItem is a no-op for unknown key', async () => {
      await expect(adapter.removeItem('ghost')).resolves.not.toThrow();
    });

    it('different keys do not interfere', async () => {
      await adapter.setItem('a', 1);
      await adapter.setItem('b', 2);
      expect(await adapter.getItem('a')).toBe(1);
      expect(await adapter.getItem('b')).toBe(2);
    });

    it('handles null value in storage gracefully', async () => {
      // Should return null, not throw
      const result = await adapter.getItem<string>('never-set');
      expect(result).toBeNull();
    });
  });
}

// Run the same contract tests against both adapters
runStorageContractTests(
  'AsyncStorageAdapter',
  () => new AsyncStorageAdapter(makeFakeAsyncStorage())
);

runStorageContractTests(
  'MMKVAdapter',
  () => new MMKVAdapter(makeFakeMMKV())
);

// -----------------------------------------------------------
// AsyncStorageAdapter — specific behaviour
// -----------------------------------------------------------
describe('AsyncStorageAdapter', () => {
  it('handles malformed JSON in storage gracefully', async () => {
    const fakeStorage = {
      async getItem(_key: string) { return '{not valid json'; },
      async setItem() {},
      async removeItem() {},
    };
    const adapter = new AsyncStorageAdapter(fakeStorage);
    const result = await adapter.getItem('key');
    expect(result).toBeNull(); // doesn't throw
  });
});

// -----------------------------------------------------------
// MMKVAdapter — specific behaviour
// -----------------------------------------------------------
describe('MMKVAdapter', () => {
  it('handles undefined returned by MMKV getString', async () => {
    const fakeMMKV = {
      getString: (_key: string) => undefined,
      set() {},
      delete() {},
    };
    const adapter = new MMKVAdapter(fakeMMKV);
    const result = await adapter.getItem('key');
    expect(result).toBeNull();
  });

  it('handles malformed JSON gracefully', async () => {
    const fakeMMKV = {
      getString: (_key: string) => '{bad json',
      set() {},
      delete() {},
    };
    const adapter = new MMKVAdapter(fakeMMKV);
    const result = await adapter.getItem('key');
    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------
// MemoryNetworkAdapter
// -----------------------------------------------------------
describe('MemoryNetworkAdapter', () => {
  it('starts connected when initiallyConnected = true', async () => {
    const adapter = new MemoryNetworkAdapter(true);
    expect(await adapter.isConnected()).toBe(true);
  });

  it('starts disconnected when initiallyConnected = false', async () => {
    const adapter = new MemoryNetworkAdapter(false);
    expect(await adapter.isConnected()).toBe(false);
  });

  it('reflects updated connectivity after setConnected', async () => {
    const adapter = new MemoryNetworkAdapter(false);
    adapter.setConnected(true);
    expect(await adapter.isConnected()).toBe(true);
  });

  it('fires listener when connectivity changes', () => {
    const adapter = new MemoryNetworkAdapter(false);
    const listener = vi.fn();
    adapter.onConnectivityChange(listener);
    adapter.setConnected(true);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('does not fire listener when value stays the same', () => {
    const adapter = new MemoryNetworkAdapter(true);
    const listener = vi.fn();
    adapter.onConnectivityChange(listener);
    adapter.setConnected(true); // no change
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires multiple listeners', () => {
    const adapter = new MemoryNetworkAdapter(false);
    const l1 = vi.fn();
    const l2 = vi.fn();
    adapter.onConnectivityChange(l1);
    adapter.onConnectivityChange(l2);
    adapter.setConnected(true);
    expect(l1).toHaveBeenCalledWith(true);
    expect(l2).toHaveBeenCalledWith(true);
  });

  it('stops firing after unsubscribe', () => {
    const adapter = new MemoryNetworkAdapter(false);
    const listener = vi.fn();
    const unsubscribe = adapter.onConnectivityChange(listener);
    unsubscribe();
    adapter.setConnected(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles multiple subscribe/unsubscribe cycles', () => {
    const adapter = new MemoryNetworkAdapter(false);
    const l1 = vi.fn();
    const l2 = vi.fn();
    const unsub1 = adapter.onConnectivityChange(l1);
    adapter.onConnectivityChange(l2);
    unsub1();

    adapter.setConnected(true);
    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledWith(true);
  });
});
