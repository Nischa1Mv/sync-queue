import type { StorageAdapter } from '../types';
/**
 * Adapter for react-native-mmkv.
 *
 * @example
 * import { MMKV } from 'react-native-mmkv';
 * import { MMKVAdapter } from 'sync-queue/adapters';
 *
 * const mmkv = new MMKV();
 * const storage = new MMKVAdapter(mmkv);
 */
export declare class MMKVAdapter implements StorageAdapter {
    private readonly mmkv;
    constructor(mmkv: {
        getString(key: string): string | undefined;
        set(key: string, value: string): void;
        delete(key: string): void;
    });
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<void>;
    removeItem(key: string): Promise<void>;
}
//# sourceMappingURL=MMKVAdapter.d.ts.map