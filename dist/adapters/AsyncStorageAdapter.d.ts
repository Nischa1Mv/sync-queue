import type { StorageAdapter } from '../types';
/**
 * Adapter for @react-native-async-storage/async-storage.
 *
 * @example
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { AsyncStorageAdapter } from 'sync-queue/adapters';
 *
 * const storage = new AsyncStorageAdapter(AsyncStorage);
 */
export declare class AsyncStorageAdapter implements StorageAdapter {
    private readonly asyncStorage;
    constructor(asyncStorage: {
        getItem(key: string): Promise<string | null>;
        setItem(key: string, value: string): Promise<void>;
        removeItem(key: string): Promise<void>;
    });
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<void>;
    removeItem(key: string): Promise<void>;
}
//# sourceMappingURL=AsyncStorageAdapter.d.ts.map