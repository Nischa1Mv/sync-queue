export { AsyncStorageSync } from './core/singleton';
import { AsyncStorageSync } from './core/singleton';
import { AsyncStorageDriver } from './drivers/AsyncStorageDriver';
import type { InitConfig } from './types';
import type { AsyncStorageClient } from './drivers/AsyncStorageDriver';

let initPromise: Promise<AsyncStorageSync> | null = null;

/**
 * Initialize once at app startup (safe to call repeatedly).
 */
export async function initSyncQueue(config: InitConfig): Promise<AsyncStorageSync> {
  try {
    return AsyncStorageSync.getInstance();
  } catch {
    if (!initPromise) {
      initPromise = AsyncStorageSync.init(config).finally(() => {
        initPromise = null;
      });
    }
    return initPromise;
  }
}

/**
 * Get initialized singleton instance.
 */
export function getSyncQueue(): AsyncStorageSync {
  return AsyncStorageSync.getInstance();
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
