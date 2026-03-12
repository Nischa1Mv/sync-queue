import type { QueueItem, StorageAdapter, ItemStatus } from '../types';
export declare class QueueStore<TPayload> {
    private readonly storage;
    private readonly storageKey;
    constructor(storage: StorageAdapter, storageKey: string);
    getAll(): Promise<QueueItem<TPayload>[]>;
    getById(id: string): Promise<QueueItem<TPayload> | null>;
    getByStatus(...statuses: ItemStatus[]): Promise<QueueItem<TPayload>[]>;
    add(item: QueueItem<TPayload>): Promise<void>;
    update(id: string, patch: Partial<QueueItem<TPayload>>): Promise<void>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
    count(): Promise<number>;
    countByStatus(...statuses: ItemStatus[]): Promise<number>;
}
//# sourceMappingURL=QueueStore.d.ts.map