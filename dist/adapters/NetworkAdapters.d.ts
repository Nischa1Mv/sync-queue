import type { NetworkAdapter } from '../types';
/**
 * Adapter for @react-native-community/netinfo.
 *
 * @example
 * import NetInfo from '@react-native-community/netinfo';
 * import { NetInfoAdapter } from 'sync-queue/adapters';
 *
 * const network = new NetInfoAdapter(NetInfo);
 */
export declare class NetInfoAdapter implements NetworkAdapter {
    private readonly netInfo;
    constructor(netInfo: {
        fetch(): Promise<{
            isConnected: boolean | null;
        }>;
        addEventListener(listener: (state: {
            isConnected: boolean | null;
        }) => void): () => void;
    });
    isConnected(): Promise<boolean>;
    onConnectivityChange(callback: (isConnected: boolean) => void): () => void;
}
/**
 * Simple in-memory network adapter.
 * Useful for testing or web apps where NetInfo isn't available.
 *
 * @example
 * const network = new MemoryNetworkAdapter(true); // starts online
 * network.setConnected(false); // simulate going offline
 */
export declare class MemoryNetworkAdapter implements NetworkAdapter {
    private _isConnected;
    private _listeners;
    constructor(initiallyConnected?: boolean);
    isConnected(): Promise<boolean>;
    onConnectivityChange(callback: (isConnected: boolean) => void): () => void;
    /** Test helper: toggle connectivity and fire all listeners */
    setConnected(value: boolean): void;
}
//# sourceMappingURL=NetworkAdapters.d.ts.map