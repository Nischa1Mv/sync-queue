// ============================================================
// sync-queue — Public API
// ============================================================

// Core
export { SyncQueue, ValidationError } from './core/SyncQueue';

// React Hooks
export { useQueue, useSyncQueue, useNetworkStatus } from './hooks';

// Storage Adapters
export { AsyncStorageAdapter } from './adapters/AsyncStorageAdapter';
export { MMKVAdapter } from './adapters/MMKVAdapter';
export { NetInfoAdapter, MemoryNetworkAdapter } from './adapters/NetworkAdapters';

// Types — everything a consuming app needs to type its usage
export type {
  // Core data
  QueueItem,
  AddItemInput,
  ItemStatus,

  // Adapter contracts (implement these to bring your own storage/network)
  StorageAdapter,
  NetworkAdapter,

  // Sync handler
  SyncHandler,
  SyncHandlerContext,
  SyncOutcome,

  // Conflict resolution
  ConflictResolution,
  ConflictStrategy,

  // Validation
  PayloadValidator,
  ValidatorResult,

  // Retry
  RetryPolicy,

  // Results
  SyncResult,
  SyncItemResult,

  // Config
  SyncQueueConfig,
} from './types';
