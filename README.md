# async-storage-sync

**Offline-first data layer for React Native** — Save locally, sync when connected.

## Install

```bash
npm install async-storage-sync @react-native-async-storage/async-storage @react-native-community/netinfo
```

`@react-native-async-storage/async-storage` and `@react-native-community/netinfo` are required peer dependencies used by this package.

## 30-Second Start

Initialize once in your app (no separate files required):

```ts
// App.tsx
import React, { useEffect } from 'react';
import { initSyncQueue } from 'async-storage-sync';

export default function App() {
  useEffect(() => {
    void initSyncQueue({
      driver: 'asyncstorage',
      serverUrl: 'https://api.example.com',
      credentials: { apiKey: 'YOUR_API_KEY' },
      endpoint: '/submit',
      autoSync: false,
    });
  }, []);

  return <YourApp />;
}
```

Now use it anywhere in your app:

```ts
import { getSyncQueue } from 'async-storage-sync';

const store = getSyncQueue();

// Save record (saved locally immediately)
await store.save('forms', { 
  formId: '123', 
  name: 'John', 
  timestamp: new Date().toISOString() 
});

// Sync and get summary result
const result = await store.flushWithResult();
console.log(`Synced: ${result.synced}, Failed: ${result.failed}, Remaining: ${result.remainingPending}`);

// List pending records
const pending = await store.getAll('forms');
console.log(`${pending.length} forms waiting to sync`);
```

## Sync Behavior (Auto vs Manual)

- `autoSync: true` (default): when the app starts, the package checks connectivity and attempts sync if online.
- `autoSync: true` also listens for reconnect events and retries pending items automatically.
- `autoSyncCollections` (optional): when set, auto-sync on reconnect targets only those collections.
- `autoSync: false`: no automatic syncing; call sync methods manually when you choose.
- Manual methods:
  - `store.flushWithResult()` → sync all pending and return summary counts
  - `store.syncWithResult(collection)` → sync one collection and return summary counts
  - `store.syncManyWithResult(collections)` → sync only selected collections and return merged summary counts
  - `store.syncById(collection, id)` → sync one record
- Sync destination is controlled by your config: `serverUrl + endpoint`.

## API Reference

### Setup

| Function | Purpose |
|--------|---------|
| `initSyncQueue(config)` | Initialize singleton once at app startup (safe to call repeatedly) |
| `getSyncQueue()` | Get initialized singleton instance |
| `setStorageDriver(storage)` | Inject storage client explicitly (useful for symlink/local package setups) |

### Store Methods (`const store = getSyncQueue()`)

| Method | Purpose |
|--------|---------|
| `store.save(collection, data, options?)` | Save one record locally and enqueue for sync |
| `store.getAll(collection)` | Get all records from one collection |
| `store.getById(collection, id)` | Get one record by internal `_id` |
| `store.deleteById(collection, id)` | Delete one record by internal `_id` |
| `store.deleteCollection(collection)` | Delete all records in one collection |
| `store.flushWithResult()` | Sync all pending and return detailed summary (`attempted`, `synced`, `failed`, `retried`, `remainingPending`, `items`) |
| `store.syncWithResult(collection)` | Sync collection and return detailed summary (same format as `flushWithResult()`) |
| `store.syncManyWithResult(collections)` | Sync selected collections and return one merged summary (same format as `flushWithResult()`) |
| `store.syncById(collection, id)` | Sync one specific record by internal `_id` |
| `store.requeueFailed()` | Move `failed` records back to pending queue for retry |
| `store.onSynced(callback)` | Event callback for successful sync of each item |
| `store.onAuthError(callback)` | Event callback when sync returns `401` or `403` |
| `store.onStorageFull(callback)` | Event callback when local storage is full on save |
| `store.getQueue()` | Inspect in-memory queue items (debug/metrics) |
| `store.destroy()` | Stop engine, clear queue/storage, and reset singleton |

## Quick Examples

**Auto-sync when internet reconnects:**
```ts
import NetInfo from '@react-native-community/netinfo';
import { getSyncQueue } from 'async-storage-sync';

NetInfo.addEventListener(state => {
  if (state.isConnected) {
    void getSyncQueue().flushWithResult();
  }
});
```

**Handle authentication errors:**
```ts
const store = getSyncQueue();

store.onAuthError((statusCode, item) => {
  if (statusCode === 401 || statusCode === 403) {
    console.log('Session expired, re-login needed');
  }
});
```

**Transform data before sending to server:**
```ts
initSyncQueue({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: { apiKey: 'KEY' },
  endpoint: '/submit',
  payloadTransformer: (record) => {
    const { _id, _ts, _synced, _retries, ...payload } = record;
    return payload;
  },
});
```

**Use custom auth headers/keys:**
```ts
initSyncQueue({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: {
    Authorization: 'Token abc123',
    'x-api-key': 'my-custom-key',
  },
  endpoint: '/submit',
});
```

**Handle duplicates:**
```ts
// Keep all (default)
await store.save('logs', { event: 'tap' });

// Replace existing type
await store.save('profile', { userId: 1, name: 'Bob' }, {
  type: 'currentUser',
  duplicateStrategy: 'overwrite',
});
```

**Logout cleanup:**
```ts
const store = getSyncQueue();
await store.deleteCollection('submissions');
```

## Configuration

```ts
initSyncQueue({
  driver: 'asyncstorage',           // (required) only driver type
  serverUrl: string,                // (required) API base URL
  credentials: Record<string, string>, // (required) merged into request headers
  endpoint?: '/submit',             // route to POST data
  autoSync?: false,                 // auto-sync on reconnect
  autoSyncCollections?: ['invoices', 'payments'], // optional: only these collections auto-sync on reconnect
  onSyncSuccess?: 'keep',           // after sync: keep|delete|ttl
  ttl?: 7 * 24 * 60 * 60 * 1000,   // if ttl mode, keep duration
  duplicateStrategy?: 'append',     // append or overwrite
  payloadTransformer?: (r) => r,    // optional: shape before send
});
```

Notes:
- `credentials.apiKey` remains supported and is sent as `Authorization: Bearer <apiKey>` if no `Authorization` header is provided.
- Any other key/value pairs in `credentials` are sent as-is in request headers.

## How It Works

1. **Save** — Records written to AsyncStorage immediately
2. **Queue** — Each save queued for syncing
3. **Sync** — `flushWithResult()` POSTs all pending to your server and returns summary output
4. **Status** — Records marked synced, then kept or deleted
5. **Retry** — Failed syncs retry automatically (max 5x)
6. **Persist** — Everything survives app restart

## Storage

- `asyncstorage::<collectionName>` — Your records + metadata (`_id`, `_ts`, `_synced`, `_retries`)
- `asyncstorage::__queue__` — Sync queue

## Limits

✅ Works: 100s-1000s of records, multiple collections, TypeScript support, app crashes  
❌ Limits: Max 5 retries, not a full database, config locks after init

## Production Checklist

- [ ] Use `payloadTransformer` to remove `_` fields before server
- [ ] Handle `onAuthError` for 401/403
- [ ] Set `autoSync: false` if you control sync timing
- [ ] Test with `NetInfo` reconnect listener
- [ ] Call `deleteCollection()` on logout
- [ ] Monitor queue with `getQueue()` for ops metrics
