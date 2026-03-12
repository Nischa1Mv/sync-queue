// ============================================================
// sync-queue — AsyncStorage Adapter
// Plug this in if your app uses @react-native-async-storage/async-storage
// ============================================================

import type { StorageAdapter } from '../types';

/**
 * Adapter for @react-native-async-storage/async-storage.
 *
 * @example
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { AsyncStorageAdapter } from 'sync-queue/adapters';
 *
 * const storage = new AsyncStorageAdapter(AsyncStorage);
 */
export class AsyncStorageAdapter implements StorageAdapter {
  constructor(
    private readonly asyncStorage: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    }
  ) {}

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.asyncStorage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    await this.asyncStorage.setItem(key, JSON.stringify(value));
  }

  async removeItem(key: string): Promise<void> {
    await this.asyncStorage.removeItem(key);
  }
}
