import type { Queue } from './queue';
import type { IStorageDriver } from '../drivers/IStorageDriver';
import type {
  ResolvedConfig,
  QueueItem,
  StoredRecord,
  SyncedCallback,
  AuthErrorCallback,
  OnSyncSuccess,
} from '../types';

declare const require: (id: string) => any;

const DEBOUNCE_MS = 500;
const BACKOFF_BASE_MS = 1000;

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
      void this.flush();
    }, DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.isFlushing) {
      console.log('[SyncEngine] flush() skipped — already flushing');
      return;
    }
    this.isFlushing = true;

    try {
      const pending = this.queue.getPending();
      console.log('[SyncEngine] flush() — pending items:', pending.length);
      if (pending.length === 0) {
        console.log('[SyncEngine] Nothing to sync.');
        return;
      }
      for (const item of pending) {
        await this.syncItem(item);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  async flushCollection(collectionName: string): Promise<void> {
    const pending = this.queue.getPendingForCollection(collectionName);
    for (const item of pending) {
      await this.syncItem(item);
    }
  }

  async flushRecord(recordId: string): Promise<void> {
    const item = this.queue.getPendingForRecord(recordId);
    if (item) {
      await this.syncItem(item);
    }
  }

  private async syncItem(item: QueueItem): Promise<void> {
    if (item.retries > 0) {
      const backoffMs = Math.pow(2, item.retries) * BACKOFF_BASE_MS;
      const elapsed = Date.now() - item.ts;
      if (elapsed < backoffMs) {
        console.log(`[SyncEngine] syncItem backoff — retries: ${item.retries}, wait: ${backoffMs - elapsed}ms remaining`);
        return;
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
          Authorization: `Bearer ${this.config.credentials.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      console.log(`[SyncEngine] Response: ${response.status} ${response.statusText}`);
      if (response.ok) {
        await this.handleSuccess(item);
      } else if (response.status >= 400 && response.status < 500) {
        await this.handleClientError(item, response.status);
      } else if (response.status >= 500) {
        await this.handleServerError(item);
      }
    } catch (e) {
      console.warn('[SyncEngine] 🔌 Network error (offline?) — will retry on next flush:', e);
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
