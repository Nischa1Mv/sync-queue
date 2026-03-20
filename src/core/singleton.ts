import type { IStorageDriver } from '../drivers/IStorageDriver';
import { AsyncStorageDriver } from '../drivers/AsyncStorageDriver';
import type {
  InitConfig,
  ResolvedConfig,
  SaveOptions,
  StoredRecord,
  SyncStore,
  QueueItem,
  FlushResult,
  SyncedCallback,
  AuthErrorCallback,
  StorageFullCallback,
  DuplicateStrategy,
} from '../types';
import { Queue } from './queue';
import { SyncEngine } from './sync-engine';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function collectionKey(name: string): string {
  return `asyncstorage::${name}`;
}

const DEFAULTS = {
  autoSync: true,
  endpoint: '/sync',
  onSyncSuccess: 'keep' as const,
  ttl: 7 * 24 * 60 * 60 * 1000,
  duplicateStrategy: 'append' as const,
};

function resolveRecordId(
  data: Record<string, unknown>,
  resolver?: (item: Record<string, unknown>) => string
): string {
  if (!resolver) return generateId();
  const resolved = resolver(data);
  return resolved && resolved.trim().length > 0 ? resolved : generateId();
}

export class AsyncStorageSync {
  private static instance: AsyncStorageSync | null = null;

  private readonly queue: Queue;
  private readonly engine: SyncEngine;

  private constructor(
    private readonly config: ResolvedConfig,
    private readonly driver: IStorageDriver
  ) {
    this.queue = new Queue(driver);
    this.engine = new SyncEngine(config, this.queue, driver);
  }

  static async init(config: InitConfig): Promise<AsyncStorageSync> {
    if (AsyncStorageSync.instance) {
      return AsyncStorageSync.instance;
    }

    let driver: IStorageDriver;
    if (config.driver === 'asyncstorage') {
      driver = new AsyncStorageDriver();
    } else {
      throw new Error(
        `[async-storage-sync] Unknown driver: "${config.driver}". Only "asyncstorage" is available in v1.`
      );
    }

    const fullConfig: ResolvedConfig = {
      autoSync: DEFAULTS.autoSync,
      endpoint: DEFAULTS.endpoint,
      onSyncSuccess: DEFAULTS.onSyncSuccess,
      ttl: DEFAULTS.ttl,
      duplicateStrategy: DEFAULTS.duplicateStrategy,
      ...config,
    };

    const instance = new AsyncStorageSync(fullConfig, driver);
    await instance.queue.load();
    await instance.requeueFailed();
    if (fullConfig.autoSync) {
      console.log('[AsyncStorageSync] autoSync enabled — starting sync engine');
      instance.engine.start();
    } else {
      console.log('[AsyncStorageSync] autoSync disabled — call flushWithResult() or syncWithResult(collection) manually');
    }

    AsyncStorageSync.instance = instance;
    return instance;
  }

  static getInstance(): AsyncStorageSync {
    if (!AsyncStorageSync.instance) {
      throw new Error(
        '[async-storage-sync] getInstance() called before init(). Call AsyncStorageSync.init(...) first.'
      );
    }
    return AsyncStorageSync.instance;
  }

  async save<T extends Record<string, unknown>>(
    name: string,
    data: T,
    options: SaveOptions = {}
  ): Promise<StoredRecord<T>> {
    const strategy: DuplicateStrategy =
      options.duplicateStrategy ?? this.config.duplicateStrategy ?? DEFAULTS.duplicateStrategy;

    const type = options.type ?? name;

    const records = await this.getCollection<T>(name);

    if (strategy === 'overwrite') {
      const existingIndex = records.findIndex((record) => record.meta.type === type);
      if (existingIndex !== -1) {
        const existing = records[existingIndex];
        const updated: StoredRecord<T> = {
          meta: {
            ...existing.meta,
            ts: Date.now(),
            synced: 'pending',
            type,
          },
          data,
        };

        records[existingIndex] = updated;
        await this.saveCollection(name, records);
        await this.enqueueRecord(name, updated, options);
        return updated;
      }
    }

    const record: StoredRecord<T> = {
      meta: {
        id: resolveRecordId(data, this.config.idResolver),
        ts: Date.now(),
        synced: 'pending',
        type,
        retries: 0,
      },
      data,
    };

    records.push(record);

    try {
      await this.saveCollection(name, records);
    } catch (error) {
      if (String(error).includes('STORAGE_FULL')) {
        this.engine.emitStorageFull();
        throw new Error('[async-storage-sync] Storage is full.');
      }
      throw error;
    }

    await this.enqueueRecord(name, record, options);
    return record;
  }

  private async enqueueRecord<T extends Record<string, unknown>>(
    name: string,
    record: StoredRecord<T>,
    _options: SaveOptions
  ): Promise<void> {
    const queueItem: QueueItem = {
      id: generateId(),
      key: name,
      recordId: record.meta.id,
      payload: JSON.stringify(record),
      endpoint: this.config.endpoint,
      ts: Date.now(),
      retries: 0,
      synced: false,
    };

    await this.queue.enqueue(queueItem);
  }

  async getAll<T extends Record<string, unknown>>(name: string): Promise<StoredRecord<T>[]> {
    return this.getCollection<T>(name);
  }

  async getById<T extends Record<string, unknown>>(
    name: string,
    id: string
  ): Promise<StoredRecord<T> | null> {
    const records = await this.getCollection<T>(name);
    return records.find((record) => record.meta.id === id) ?? null;
  }

  async deleteById(name: string, id: string): Promise<void> {
    const records = await this.getCollection(name);
    await this.saveCollection(
      name,
      records.filter((record) => record.meta.id !== id)
    );
  }

  async deleteCollection(name: string): Promise<void> {
    await this.driver.remove(collectionKey(name));
  }

  async syncWithResult<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): Promise<FlushResult<T>> {
    return this.engine.flushCollectionWithResult(name);
  }

  async syncManyWithResult<T extends Record<string, unknown> = Record<string, unknown>>(
    names: string[]
  ): Promise<FlushResult<T>> {
    return this.engine.flushCollectionsWithResult(names);
  }

  async syncById(_name: string, id: string): Promise<void> {
    await this.engine.flushRecord(id);
  }

  async flushWithResult<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<
    FlushResult<T>
  > {
    return this.engine.flushWithResult();
  }

  asType<T extends Record<string, unknown>>(): SyncStore<T> {
    return {
      save: (collection, item, options) => this.save<T>(collection, item, options),
      getAll: (collection) => this.getAll<T>(collection),
      getById: (collection, id) => this.getById<T>(collection, id),
      flushWithResult: () => this.flushWithResult<T>(),
    };
  }

  /**
   * Re-enqueue any records marked as 'failed' so they are retried on next flush.
   * Called automatically on init to recover from previous 4xx/500 failures.
   */
  async requeueFailed(): Promise<void> {
    const allKeys = await this.driver.getAllKeys();
    const collectionKeys = allKeys.filter((k) => k.startsWith('asyncstorage::') && k !== 'asyncstorage::sync_queue');

    let total = 0;
    for (const storageKey of collectionKeys) {
      const collectionName = storageKey.replace('asyncstorage::', '');
      const raw = await this.driver.get(storageKey);
      if (!raw) continue;

      const records: StoredRecord[] = JSON.parse(raw);
      const failed = records.filter((r) => r.meta.synced === 'failed');

      for (const record of failed) {
        const queueItem: QueueItem = {
          id: generateId(),
          key: collectionName,
          recordId: record.meta.id,
          payload: JSON.stringify(record),
          endpoint: this.config.endpoint,
          ts: Date.now(),
          retries: 0,
          synced: false,
        };
        await this.queue.enqueue(queueItem);
        // Reset status to pending
        record.meta.synced = 'pending';
        total++;
      }

      if (failed.length > 0) {
        await this.driver.set(storageKey, JSON.stringify(records));
      }
    }

    if (total > 0) {
      console.log(`[AsyncStorageSync] ♻️ Re-enqueued ${total} previously failed record(s) for retry`);
    }
  }

  onSynced(cb: SyncedCallback): void {
    this.engine.onSynced(cb);
  }

  onAuthError(cb: AuthErrorCallback): void {
    this.engine.onAuthError(cb);
  }

  onStorageFull(cb: StorageFullCallback): void {
    this.engine.onStorageFull(cb);
  }

  getQueue(): QueueItem[] {
    return this.queue.getAll();
  }

  async destroy(): Promise<void> {
    this.engine.stop();
    await this.queue.clear();
    await this.driver.clear();
    AsyncStorageSync.instance = null;
  }

  private async getCollection<T extends Record<string, unknown>>(
    name: string
  ): Promise<StoredRecord<T>[]> {
    const raw = await this.driver.get(collectionKey(name));
    return raw ? (JSON.parse(raw) as StoredRecord<T>[]) : [];
  }

  private async saveCollection(name: string, records: StoredRecord[]): Promise<void> {
    await this.driver.set(collectionKey(name), JSON.stringify(records));
  }
}
