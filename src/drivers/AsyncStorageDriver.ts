import type { IStorageDriver } from './IStorageDriver';

declare const require: (id: string) => any;

export type AsyncStorageClient = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[] | null>;
  clear(): Promise<void>;
};

export class AsyncStorageDriver implements IStorageDriver {
  private static injectedStorage: AsyncStorageClient | null = null;

  static setStorageClient(storage: AsyncStorageClient): void {
    AsyncStorageDriver.injectedStorage = storage;
  }

  private storage: AsyncStorageClient;

  constructor() {
    if (AsyncStorageDriver.injectedStorage) {
      this.storage = AsyncStorageDriver.injectedStorage;
      return;
    }

    const injectedStorage = (globalThis as { __ASYNC_STORAGE__?: AsyncStorageClient }).__ASYNC_STORAGE__;
    if (injectedStorage) {
      this.storage = injectedStorage;
      return;
    }

    try {
      this.storage = require('@react-native-async-storage/async-storage').default;
    } catch {
      throw new Error(
        '[async-storage-sync] AsyncStorageDriver requires @react-native-async-storage/async-storage.'
      );
    }
  }

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.storage.setItem(key, value);
    } catch (error) {
      if (String(error).includes('quota') || String(error).includes('full')) {
        throw new Error('STORAGE_FULL');
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }

  async getAllKeys(): Promise<string[]> {
    const keys = await this.storage.getAllKeys();
    return keys ? [...keys] : [];
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }
}
