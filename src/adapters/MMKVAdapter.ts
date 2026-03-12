// ============================================================
// sync-queue — MMKV Adapter
// Plug this in if your app uses react-native-mmkv (faster than AsyncStorage)
// ============================================================

import type { StorageAdapter } from '../types';

/**
 * Adapter for react-native-mmkv.
 *
 * @example
 * import { MMKV } from 'react-native-mmkv';
 * import { MMKVAdapter } from 'sync-queue/adapters';
 *
 * const mmkv = new MMKV();
 * const storage = new MMKVAdapter(mmkv);
 */
export class MMKVAdapter implements StorageAdapter {
  constructor(
    private readonly mmkv: {
      getString(key: string): string | undefined;
      set(key: string, value: string): void;
      delete(key: string): void;
    }
  ) {}

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const raw = this.mmkv.getString(key);
      if (raw === undefined) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    this.mmkv.set(key, JSON.stringify(value));
  }

  async removeItem(key: string): Promise<void> {
    this.mmkv.delete(key);
  }
}
