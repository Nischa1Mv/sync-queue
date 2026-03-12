// ============================================================
// sync-queue — NetInfo Network Adapter
// Plug this in if your app uses @react-native-community/netinfo
// ============================================================

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
export class NetInfoAdapter implements NetworkAdapter {
  constructor(
    private readonly netInfo: {
      fetch(): Promise<{ isConnected: boolean | null }>;
      addEventListener(
        listener: (state: { isConnected: boolean | null }) => void
      ): () => void;
    }
  ) {}

  async isConnected(): Promise<boolean> {
    const state = await this.netInfo.fetch();
    return state.isConnected === true;
  }

  onConnectivityChange(callback: (isConnected: boolean) => void): () => void {
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
export class MemoryNetworkAdapter implements NetworkAdapter {
  private _isConnected: boolean;
  private _listeners: Set<(isConnected: boolean) => void> = new Set();

  constructor(initiallyConnected = true) {
    this._isConnected = initiallyConnected;
  }

  async isConnected(): Promise<boolean> {
    return this._isConnected;
  }

  onConnectivityChange(callback: (isConnected: boolean) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /** Test helper: toggle connectivity and fire all listeners */
  setConnected(value: boolean): void {
    if (this._isConnected !== value) {
      this._isConnected = value;
      this._listeners.forEach((cb) => cb(value));
    }
  }
}
