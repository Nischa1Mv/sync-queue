import type { IStorageDriver } from '../drivers/IStorageDriver';
import type { QueueItem } from '../types';

const QUEUE_KEY = 'asyncstorage::__queue__';
const MAX_RETRIES = 5;

export class Queue {
  private items: QueueItem[] = [];
  private loaded = false;

  constructor(private readonly driver: IStorageDriver) {}

  async load(): Promise<void> {
    try {
      const raw = await this.driver.get(QUEUE_KEY);
      this.items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.assertLoaded();
    this.items.push(item);
    await this.persist();
  }

  getPending(): QueueItem[] {
    this.assertLoaded();
    return this.items.filter((item) => !item.synced && item.retries < MAX_RETRIES);
  }

  getPendingForCollection(collectionName: string): QueueItem[] {
    return this.getPending().filter((item) => item.key === collectionName);
  }

  getPendingForRecord(recordId: string): QueueItem | undefined {
    return this.getPending().find((item) => item.recordId === recordId);
  }

  getAll(): QueueItem[] {
    this.assertLoaded();
    return [...this.items];
  }

  async markSynced(itemId: string): Promise<void> {
    this.assertLoaded();
    const item = this.items.find((entry) => entry.id === itemId);
    if (item) {
      item.synced = true;
      item.retries = 0;
    }
    await this.persist();
  }

  async incrementRetry(itemId: string): Promise<void> {
    this.assertLoaded();
    const item = this.items.find((entry) => entry.id === itemId);
    if (item) {
      item.retries += 1;
    }
    await this.persist();
  }

  async remove(itemId: string): Promise<void> {
    this.assertLoaded();
    this.items = this.items.filter((entry) => entry.id !== itemId);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.items = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.driver.set(QUEUE_KEY, JSON.stringify(this.items));
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        '[Queue] Queue has not been loaded yet. Ensure AsyncStorageSync.init() has completed before use.'
      );
    }
  }
}
