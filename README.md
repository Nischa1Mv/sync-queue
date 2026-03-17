# async-storage-sync

Offline-first data layer for React Native.

Save records locally first, then sync automatically when internet is available.

## Install

```bash
npm install async-storage-sync
npm install @react-native-async-storage/async-storage
npm install @react-native-community/netinfo
```

## Quickstart

```ts
import { AsyncStorageSync } from 'async-storage-sync';

await AsyncStorageSync.init({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: { apiKey: 'your-api-key' },
  endpoint: '/sync',
  onSyncSuccess: 'keep',
  duplicateStrategy: 'append',
});

const store = AsyncStorageSync.getInstance();

await store.save('invoices', { amount: 99, date: '2026-01-01' });
await store.flush();
```

## Public API

- `AsyncStorageSync.init(config)`
- `AsyncStorageSync.getInstance()`
- `save(name, data, options?)`
- `getAll(name)`
- `getById(name, id)`
- `deleteById(name, id)`
- `deleteCollection(name)`
- `sync(name)`
- `syncById(name, id)`
- `flush()`
- `onSynced(cb)`
- `onAuthError(cb)`
- `onStorageFull(cb)`
- `getQueue()`
- `destroy()`

## Storage layout

- `asyncstorage::<collection>` for collection records
- `asyncstorage::__queue__` for pending sync operations

## Notes

- Singleton config is locked after first `init()` call.
- Queue is persisted and survives app restarts.
- Server retry policy uses exponential backoff with max retries handled by queue entries.
