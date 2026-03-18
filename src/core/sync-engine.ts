import type { Queue } from './queue';
import type { IStorageDriver } from '../drivers/IStorageDriver';
import type {
  ResolvedConfig,
  QueueItem,
  StoredRecord,
  SyncedCallback,
  AuthErrorCallback,
  OnSyncSuccess,
  FlushItemResult,
  FlushResult,
} from '../types';

declare const require: (id: string) => any;

const DEBOUNCE_MS = 500;
const BACKOFF_BASE_MS = 1000;

function buildAuthHeaders(credentials: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...credentials };
  const apiKey = headers.apiKey;

  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  delete headers.apiKey;
  return headers;
}

export class SyncEngine {
  private isFlushing = false;
  private unsubscribeNetInfo?: () => void;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  private onSyncedCb?: SyncedCallback;
  private onAuthErrorCb?: AuthErrorCallback;
  private onStorageFullCb?: () => void;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly queue: Queue,
    private readonly driver: IStorageDriver
  ) {}

  onSynced(cb: SyncedCallback): void {
    this.onSyncedCb = cb;
  }

  onAuthError(cb: AuthErrorCallback): void {
    this.onAuthErrorCb = cb;
  }

  onStorageFull(cb: () => void): void {
    this.onStorageFullCb = cb;
  }

  emitStorageFull(): void {
    this.onStorageFullCb?.();
  }

  start(): void {
    console.log('[SyncEngine] start() called');
    try {
      const NetInfo = require('@react-native-community/netinfo').default;
      console.log('[SyncEngine] NetInfo loaded ✅');

      this.unsubscribeNetInfo = NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
        console.log('[SyncEngine] NetInfo change → isConnected:', state.isConnected);
        if (state.isConnected) {
          this.scheduleFlush();
        }
      });

      NetInfo.fetch().then((state: { isConnected: boolean | null }) => {
        console.log('[SyncEngine] NetInfo.fetch() → isConnected:', state.isConnected);
        if (state.isConnected) {
          this.scheduleFlush();
        }
      });
    } catch (e) {
      console.warn('[SyncEngine] ⚠️ NetInfo not available — auto-sync disabled. Error:', e);
      console.warn('[SyncEngine] Install @react-native-community/netinfo to enable auto-sync.');
    }
  }

  stop(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = undefined;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private scheduleFlush(): void {
    console.log('[SyncEngine] scheduleFlush() — debounce', DEBOUNCE_MS, 'ms');
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.flushAutoSyncTargetWithResult();
    }, DEBOUNCE_MS);
  }

  private async flushAutoSyncTargetWithResult(): Promise<FlushResult> {
    const configuredCollections = this.config.autoSyncCollections
      ?.map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (!configuredCollections || configuredCollections.length === 0) {
      return this.flushWithResult();
    }

    return this.flushCollectionsWithResult(configuredCollections);
  }

  private createEmptyResult(): FlushResult {
    return {
      attempted: 0,
      synced: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
      networkErrors: 0,
      remainingPending: 0,
      skippedAlreadyFlushing: false,
      items: [],
    };
  }

  private mergeResult(target: FlushResult, source: FlushResult): void {
    target.attempted += source.attempted;
    target.synced += source.synced;
    target.failed += source.failed;
    target.retried += source.retried;
    target.deferred += source.deferred;
    target.networkErrors += source.networkErrors;
    target.items.push(...source.items);
    target.remainingPending = source.remainingPending;
    target.skippedAlreadyFlushing = target.skippedAlreadyFlushing || source.skippedAlreadyFlushing;
  }

  async flushCollectionsWithResult(collectionNames: string[]): Promise<FlushResult> {
    const result = this.createEmptyResult();

    for (const collectionName of collectionNames) {
      const collectionResult = await this.flushCollectionWithResult(collectionName);
      this.mergeResult(result, collectionResult);
    }

    result.remainingPending = this.queue.getPending().length;
    return result;
  }

  async flushWithResult(): Promise<FlushResult> {
    if (this.isFlushing) {
      console.log('[SyncEngine] flush() skipped — already flushing');
      return {
        attempted: 0,
        synced: 0,
        failed: 0,
        retried: 0,
        deferred: 0,
        networkErrors: 0,
        remainingPending: this.queue.getPending().length,
        skippedAlreadyFlushing: true,
        items: [],
      };
    }
    this.isFlushing = true;

    const result: FlushResult = this.createEmptyResult();

    try {
      const pending = this.queue.getPending();
      console.log('[SyncEngine] flush() — pending items:', pending.length);
      if (pending.length === 0) {
        console.log('[SyncEngine] Nothing to sync.');
        result.remainingPending = 0;
        return result;
      }
      for (const item of pending) {
        result.attempted += 1;
        const itemResult = await this.syncItem(item);
        result.items.push(itemResult);
        if (itemResult.status === 'synced') {
          result.synced += 1;
        } else if (itemResult.status === 'failed') {
          result.failed += 1;
        } else if (itemResult.status === 'retried') {
          result.retried += 1;
        } else if (itemResult.status === 'deferred-backoff') {
          result.deferred += 1;
        } else if (itemResult.status === 'network-error') {
          result.networkErrors += 1;
        }
      }

      result.remainingPending = this.queue.getPending().length;
      return result;
    } finally {
      this.isFlushing = false;
    }
  }

  async flushCollectionWithResult(collectionName: string): Promise<FlushResult> {
    if (this.isFlushing) {
      return {
        attempted: 0,
        synced: 0,
        failed: 0,
        retried: 0,
        deferred: 0,
        networkErrors: 0,
        remainingPending: this.queue.getPendingForCollection(collectionName).length,
        skippedAlreadyFlushing: true,
        items: [],
      };
    }
    this.isFlushing = true;

    const result: FlushResult = this.createEmptyResult();

    try {
      const pending = this.queue.getPendingForCollection(collectionName);
      if (pending.length === 0) {
        result.remainingPending = this.queue.getPendingForCollection(collectionName).length;
        return result;
      }

      for (const item of pending) {
        result.attempted += 1;
        const itemResult = await this.syncItem(item);
        result.items.push(itemResult);
        if (itemResult.status === 'synced') {
          result.synced += 1;
        } else if (itemResult.status === 'failed') {
          result.failed += 1;
        } else if (itemResult.status === 'retried') {
          result.retried += 1;
        } else if (itemResult.status === 'deferred-backoff') {
          result.deferred += 1;
        } else if (itemResult.status === 'network-error') {
          result.networkErrors += 1;
        }
      }

      result.remainingPending = this.queue.getPendingForCollection(collectionName).length;
      return result;
    } finally {
      this.isFlushing = false;
    }
  }

  async flushRecord(recordId: string): Promise<void> {
    const item = this.queue.getPendingForRecord(recordId);
    if (item) {
      await this.syncItem(item);
    }
  }

  private async syncItem(item: QueueItem): Promise<FlushItemResult> {
    if (item.retries > 0) {
      const backoffMs = Math.pow(2, item.retries) * BACKOFF_BASE_MS;
      const elapsed = Date.now() - item.ts;
      if (elapsed < backoffMs) {
        console.log(`[SyncEngine] syncItem backoff — retries: ${item.retries}, wait: ${backoffMs - elapsed}ms remaining`);
        return {
          itemId: item.id,
          collection: item.key,
          recordId: item.recordId,
          status: 'deferred-backoff',
        };
      }
    }

    try {
      const url = `${this.config.serverUrl}${this.config.endpoint}`;
      console.log(`[SyncEngine] 📤 POST ${url} — key: ${item.key}, recordId: ${item.recordId}`);
      const raw: Record<string, unknown> = JSON.parse(item.payload);
      const body = this.config.payloadTransformer ? this.config.payloadTransformer(raw) : raw;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(this.config.credentials),
        },
        body: JSON.stringify(body),
      });

      console.log(`[SyncEngine] Response: ${response.status} ${response.statusText}`);
      if (response.ok) {
        await this.handleSuccess(item);
        return {
          itemId: item.id,
          collection: item.key,
          recordId: item.recordId,
          status: 'synced',
          httpStatus: response.status,
        };
      } else if (response.status >= 400 && response.status < 500) {
        await this.handleClientError(item, response.status);
        return {
          itemId: item.id,
          collection: item.key,
          recordId: item.recordId,
          status: 'failed',
          httpStatus: response.status,
        };
      } else if (response.status >= 500) {
        await this.handleServerError(item);
        return {
          itemId: item.id,
          collection: item.key,
          recordId: item.recordId,
          status: 'retried',
          httpStatus: response.status,
        };
      }

      return {
        itemId: item.id,
        collection: item.key,
        recordId: item.recordId,
        status: 'failed',
        httpStatus: response.status,
      };
    } catch (e) {
      console.warn('[SyncEngine] 🔌 Network error (offline?) — will retry on next flush:', e);
      return {
        itemId: item.id,
        collection: item.key,
        recordId: item.recordId,
        status: 'network-error',
      };
    }
  }

  private async handleSuccess(item: QueueItem): Promise<void> {
    await this.queue.markSynced(item.id);

    const strategy: OnSyncSuccess = this.config.onSyncSuccess ?? 'keep';

    if (strategy === 'delete') {
      await this.removeRecordFromCollection(item.key, item.recordId);
    } else if (strategy === 'ttl') {
      this.scheduleRecordTTL(item.key, item.recordId);
    } else {
      await this.updateRecordSyncStatus(item.key, item.recordId, 'synced');
    }

    this.onSyncedCb?.(item);
  }

  private async handleClientError(item: QueueItem, status: number): Promise<void> {
    await this.queue.remove(item.id);
    await this.updateRecordSyncStatus(item.key, item.recordId, 'failed');

    if (status === 401 || status === 403) {
      this.onAuthErrorCb?.(status, item);
    }
  }

  private async handleServerError(item: QueueItem): Promise<void> {
    await this.queue.incrementRetry(item.id);
  }

  private collectionKey(name: string): string {
    return `asyncstorage::${name}`;
  }

  private async getCollection(name: string): Promise<StoredRecord[]> {
    const raw = await this.driver.get(this.collectionKey(name));
    return raw ? (JSON.parse(raw) as StoredRecord[]) : [];
  }

  private async saveCollection(name: string, records: StoredRecord[]): Promise<void> {
    await this.driver.set(this.collectionKey(name), JSON.stringify(records));
  }

  private async updateRecordSyncStatus(
    collectionName: string,
    recordId: string,
    status: 'synced' | 'failed'
  ): Promise<void> {
    const records = await this.getCollection(collectionName);
    const index = records.findIndex((record) => record._id === recordId);
    if (index !== -1) {
      records[index]._synced = status;
      await this.saveCollection(collectionName, records);
    }
  }

  private async removeRecordFromCollection(collectionName: string, recordId: string): Promise<void> {
    const records = await this.getCollection(collectionName);
    const filtered = records.filter((record) => record._id !== recordId);
    await this.saveCollection(collectionName, filtered);
  }

  private scheduleRecordTTL(collectionName: string, recordId: string): void {
    const ttl = this.config.ttl ?? 7 * 24 * 60 * 60 * 1000;
    setTimeout(() => {
      void this.removeRecordFromCollection(collectionName, recordId);
    }, ttl);
  }
}
