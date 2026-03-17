export { AsyncStorageSync } from './core/singleton';
import { AsyncStorageSync } from './core/singleton';
import { AsyncStorageDriver } from './drivers/AsyncStorageDriver';
import type { InitConfig, SaveOptions, StoredRecord } from './types';
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

/**
 * Save a record to a local collection.
 */
export async function saveLocal<T extends Record<string, unknown>>(
  collection: string,
  data: T,
  options: SaveOptions = {}
): Promise<StoredRecord<T>> {
  return getSyncQueue().save(collection, data, options);
}

/**
 * Read all records in a local collection.
 */
export async function getLocal<T extends Record<string, unknown>>(
  collection: string
): Promise<StoredRecord<T>[]> {
  return getSyncQueue().getAll<T>(collection);
}

/**
 * Delete a record by internal storage id.
 */
export async function deleteLocalById(collection: string, id: string): Promise<void> {
  await getSyncQueue().deleteById(collection, id);
}

/**
 * Delete an entire local collection.
 */
export async function clearLocal(collection: string): Promise<void> {
  await getSyncQueue().deleteCollection(collection);
}

/**
 * Immediately flush all pending records to the server.
 * Use this to manually trigger sync (e.g. on connectivity change or after login).
 */
export async function triggerSync(): Promise<void> {
  await getSyncQueue().flush();
}

/**
 * Re-enqueue any records marked as 'failed' so they are retried.
 * Called automatically on init, but can also be triggered manually.
 */
export async function requeueFailed(): Promise<void> {
  await getSyncQueue().requeueFailed();
}

/**
 * Delete first record where `field === value`.
 */
export async function deleteLocalByField<T extends Record<string, unknown>>(
  collection: string,
  field: keyof T & string,
  value: unknown
): Promise<boolean> {
  const records = await getLocal<T>(collection);
  const target = records.find(record => (record as Record<string, unknown>)[field] === value);

  if (!target) {
    return false;
  }

  await deleteLocalById(collection, target._id);
  return true;
}

export type {
  DriverName,
  InitConfig,
  SaveOptions,
  StoredRecord,
  RecordMeta,
  QueueItem,
  OnSyncSuccess,
  DuplicateStrategy,
  SyncStatus,
  SyncedCallback,
  AuthErrorCallback,
  StorageFullCallback,
} from './types';
