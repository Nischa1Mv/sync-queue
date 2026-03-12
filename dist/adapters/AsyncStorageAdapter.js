// ============================================================
// sync-queue — AsyncStorage Adapter
// Plug this in if your app uses @react-native-async-storage/async-storage
// ============================================================
/**
 * Adapter for @react-native-async-storage/async-storage.
 *
 * @example
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { AsyncStorageAdapter } from 'sync-queue/adapters';
 *
 * const storage = new AsyncStorageAdapter(AsyncStorage);
 */
export class AsyncStorageAdapter {
    constructor(asyncStorage) {
        this.asyncStorage = asyncStorage;
    }
    async getItem(key) {
        try {
            const raw = await this.asyncStorage.getItem(key);
            if (raw === null)
                return null;
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async setItem(key, value) {
        await this.asyncStorage.setItem(key, JSON.stringify(value));
    }
    async removeItem(key) {
        await this.asyncStorage.removeItem(key);
    }
}
//# sourceMappingURL=AsyncStorageAdapter.js.map