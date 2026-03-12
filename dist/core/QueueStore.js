// ============================================================
// sync-queue — QueueStore
// Low-level read/write operations on the persisted queue.
// Apps never use this directly — it's internal to SyncQueue.
// ============================================================
export class QueueStore {
    constructor(storage, storageKey) {
        this.storage = storage;
        this.storageKey = storageKey;
    }
    // ----------------------------------------------------------
    // Read
    // ----------------------------------------------------------
    async getAll() {
        const items = await this.storage.getItem(this.storageKey);
        if (!Array.isArray(items))
            return [];
        return items;
    }
    async getById(id) {
        const items = await this.getAll();
        return items.find((i) => i.id === id) ?? null;
    }
    async getByStatus(...statuses) {
        const items = await this.getAll();
        return items.filter((i) => statuses.includes(i.status));
    }
    // ----------------------------------------------------------
    // Write
    // ----------------------------------------------------------
    async add(item) {
        const items = await this.getAll();
        await this.storage.setItem(this.storageKey, [...items, item]);
    }
    async update(id, patch) {
        const items = await this.getAll();
        const updated = items.map((i) => i.id === id ? { ...i, ...patch } : i);
        await this.storage.setItem(this.storageKey, updated);
    }
    async remove(id) {
        const items = await this.getAll();
        await this.storage.setItem(this.storageKey, items.filter((i) => i.id !== id));
    }
    async clear() {
        await this.storage.removeItem(this.storageKey);
    }
    // ----------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------
    async count() {
        return (await this.getAll()).length;
    }
    async countByStatus(...statuses) {
        return (await this.getByStatus(...statuses)).length;
    }
}
//# sourceMappingURL=QueueStore.js.map