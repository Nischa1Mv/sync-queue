// ============================================================
// sync-queue — MMKV Adapter
// Plug this in if your app uses react-native-mmkv (faster than AsyncStorage)
// ============================================================
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
export class MMKVAdapter {
    constructor(mmkv) {
        this.mmkv = mmkv;
    }
    async getItem(key) {
        try {
            const raw = this.mmkv.getString(key);
            if (raw === undefined)
                return null;
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async setItem(key, value) {
        this.mmkv.set(key, JSON.stringify(value));
    }
    async removeItem(key) {
        this.mmkv.delete(key);
    }
}
//# sourceMappingURL=MMKVAdapter.js.map