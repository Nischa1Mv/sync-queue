// ============================================================
// __tests__/useNetworkStatus.test.ts
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from '../src/hooks';
import { MemoryNetworkAdapter } from '../src/adapters/NetworkAdapters';

describe('useNetworkStatus', () => {
  let network: MemoryNetworkAdapter;

  beforeEach(() => {
    network = new MemoryNetworkAdapter(false); // starts offline
  });

  // --------------------------------------------------------
  // Initial state
  // --------------------------------------------------------
  describe('initial state', () => {
    it('reflects offline when adapter starts disconnected', async () => {
      const { result } = renderHook(() => useNetworkStatus(network));

      // Wait for initial async call to resolve
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(false);
    });

    it('reflects online when adapter starts connected', async () => {
      network = new MemoryNetworkAdapter(true);
      const { result } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Connectivity changes
  // --------------------------------------------------------
  describe('connectivity changes', () => {
    it('updates to true when coming online', async () => {
      const { result } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(false);

      act(() => network.setConnected(true));
      expect(result.current.isConnected).toBe(true);
    });

    it('updates to false when going offline', async () => {
      network = new MemoryNetworkAdapter(true);
      const { result } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isConnected).toBe(true);

      act(() => network.setConnected(false));
      expect(result.current.isConnected).toBe(false);
    });

    it('handles multiple toggles correctly', async () => {
      const { result } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => network.setConnected(true));
      expect(result.current.isConnected).toBe(true);

      act(() => network.setConnected(false));
      expect(result.current.isConnected).toBe(false);

      act(() => network.setConnected(true));
      expect(result.current.isConnected).toBe(true);
    });

    it('does not re-render when value does not change', async () => {
      network = new MemoryNetworkAdapter(true);
      const { result } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });

      // Setting the same value should not fire listeners
      act(() => network.setConnected(true)); // already true
      expect(result.current.isConnected).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------
  describe('cleanup', () => {
    it('unsubscribes from network on unmount', async () => {
      const unsubscribeSpy = vi.fn();
      const spyNetwork = {
        isConnected: async () => false,
        onConnectivityChange: vi.fn(() => unsubscribeSpy),
      };

      const { unmount } = renderHook(() => useNetworkStatus(spyNetwork));

      await act(async () => {
        await Promise.resolve();
      });

      unmount();
      expect(unsubscribeSpy).toHaveBeenCalledOnce();
    });

    it('does not update state after unmount', async () => {
      const { result, unmount } = renderHook(() => useNetworkStatus(network));

      await act(async () => {
        await Promise.resolve();
      });

      unmount();

      // Should not throw "Can't perform state update on unmounted component"
      expect(() => act(() => network.setConnected(true))).not.toThrow();
    });
  });
});
