// ============================================================
// sync-queue — NetInfo Network Adapter
// Plug this in if your app uses @react-native-community/netinfo
// ============================================================
/**
 * Adapter for @react-native-community/netinfo.
 *
 * @example
 * import NetInfo from '@react-native-community/netinfo';
 * import { NetInfoAdapter } from 'sync-queue/adapters';
 *
 * const network = new NetInfoAdapter(NetInfo);
 */
export class NetInfoAdapter {
    constructor(netInfo) {
        this.netInfo = netInfo;
    }
    async isConnected() {
        const state = await this.netInfo.fetch();
        return state.isConnected === true;
    }
    onConnectivityChange(callback) {
        return this.netInfo.addEventListener((state) => {
            callback(state.isConnected === true);
        });
    }
}
// -----------------------------------------------------------
// In-memory adapter for testing / web environments
// -----------------------------------------------------------
/**
 * Simple in-memory network adapter.
 * Useful for testing or web apps where NetInfo isn't available.
 *
 * @example
 * const network = new MemoryNetworkAdapter(true); // starts online
 * network.setConnected(false); // simulate going offline
 */
export class MemoryNetworkAdapter {
    constructor(initiallyConnected = true) {
        this._listeners = new Set();
        this._isConnected = initiallyConnected;
    }
    async isConnected() {
        return this._isConnected;
    }
    onConnectivityChange(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }
    /** Test helper: toggle connectivity and fire all listeners */
    setConnected(value) {
        if (this._isConnected !== value) {
            this._isConnected = value;
            this._listeners.forEach((cb) => cb(value));
        }
    }
}
//# sourceMappingURL=NetworkAdapters.js.map