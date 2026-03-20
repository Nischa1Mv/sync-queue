export { AsyncStorageSync } from './core/singleton';
import { AsyncStorageSync } from './core/singleton';
import { AsyncStorageDriver } from './drivers/AsyncStorageDriver';
import type { InitConfig } from './types';
import type { AsyncStorageClient } from './drivers/AsyncStorageDriver';
import type { SyncStore } from './types';

let initPromise: Promise<AsyncStorageSync> | null = null;

/**
 * Initialize once at app startup (safe to call repeatedly).
 */
export async function initSyncQueue(config: InitConfig): Promise<AsyncStorageSync> {
  if (!initPromise) {
    initPromise = AsyncStorageSync.ensureInitialized(config).finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export function isInitialized(): boolean {
  return AsyncStorageSync.isInitialized();
}

export async function ensureInitialized(config?: InitConfig): Promise<AsyncStorageSync> {
  if (!initPromise) {
    initPromise = AsyncStorageSync.ensureInitialized(config).finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

/**
 * Get initialized singleton instance.
 */
export function getSyncQueue(): AsyncStorageSync {
  return AsyncStorageSync.getInstance();
}

export function getTypedSyncQueue<T extends Record<string, unknown>>(): SyncStore<T> {
  return AsyncStorageSync.getInstance().asType<T>();
}

/**
 * Inject storage implementation explicitly (recommended for symlink/local package usage).
 */
export function setStorageDriver(storage: AsyncStorageClient): void {
  AsyncStorageDriver.setStorageClient(storage);
}

export type {
  DriverName,
  InitConfig,
  SaveOptions,
  StoredRecord,
  RecordMeta,
  SyncStore,
  QueueItem,
  FlushResult,
  FlushItemResult,
  FlushItemStatus,
  OnSyncSuccess,
  DuplicateStrategy,
  SyncStatus,
  SyncedCallback,
  AuthErrorCallback,
  StorageFullCallback,
} from './types';
