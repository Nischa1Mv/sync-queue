// ============================================================
// sync-queue — QueueStore
// Low-level read/write operations on the persisted queue.
// Apps never use this directly — it's internal to SyncQueue.
// ============================================================

import type { QueueItem, StorageAdapter, ItemStatus } from '../types';

export class QueueStore<TPayload> {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly storageKey: string
  ) {}

  // ----------------------------------------------------------
  // Read
  // ----------------------------------------------------------

  async getAll(): Promise<QueueItem<TPayload>[]> {
    const items = await this.storage.getItem<QueueItem<TPayload>[]>(
      this.storageKey
    );
    if (!Array.isArray(items)) return [];
    return items;
  }

  async getById(id: string): Promise<QueueItem<TPayload> | null> {
    const items = await this.getAll();
    return items.find((i) => i.id === id) ?? null;
  }

  async getByStatus(...statuses: ItemStatus[]): Promise<QueueItem<TPayload>[]> {
    const items = await this.getAll();
    return items.filter((i) => statuses.includes(i.status));
  }

  // ----------------------------------------------------------
  // Write
  // ----------------------------------------------------------

  async add(item: QueueItem<TPayload>): Promise<void> {
    const items = await this.getAll();
    await this.storage.setItem(this.storageKey, [...items, item]);
  }

  async update(
    id: string,
    patch: Partial<QueueItem<TPayload>>
  ): Promise<void> {
    const items = await this.getAll();
    const updated = items.map((i) =>
      i.id === id ? { ...i, ...patch } : i
    );
    await this.storage.setItem(this.storageKey, updated);
  }

  async remove(id: string): Promise<void> {
    const items = await this.getAll();
    await this.storage.setItem(
      this.storageKey,
      items.filter((i) => i.id !== id)
    );
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.storageKey);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  async count(): Promise<number> {
    return (await this.getAll()).length;
  }

  async countByStatus(...statuses: ItemStatus[]): Promise<number> {
    return (await this.getByStatus(...statuses)).length;
  }
}
