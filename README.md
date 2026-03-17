# async-storage-sync

**Offline-first data layer for React Native** — Save locally, sync when connected.

## Install

```bash
npm install async-storage-sync @react-native-async-storage/async-storage @react-native-community/netinfo
```

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

// Sync all pending records to server
await store.flush();

// List pending records
const pending = await store.getAll('forms');
console.log(`${pending.length} forms waiting to sync`);
```

## Core Methods

| Method | Purpose |
|--------|---------|
| `initSyncQueue(config)` | Initialize once at app startup |
| `getSyncQueue()` | Get the instance anywhere |
| `store.save(collection, data)` | Save a record locally |
| `store.getAll(collection)` | Get all records in collection |
| `store.getById(collection, id)` | Get one record by ID |
| `store.deleteById(collection, id)` | Delete one record |
| `store.deleteCollection(collection)` | Clear entire collection |
| `store.flush()` | Sync all pending records |
| `store.sync(collection)` | Sync one collection only |
| `store.syncById(collection, id)` | Sync one specific record |
| `store.onSynced(callback)` | Event: when record synced |
| `store.onAuthError(callback)` | Event: when sync gets 401/403 |
| `store.getQueue()` | View pending queue (debug) |

## Quick Examples

**Auto-sync when internet reconnects:**
```ts
import NetInfo from '@react-native-community/netinfo';
import { getSyncQueue } from 'async-storage-sync';

NetInfo.addEventListener(state => {
  if (state.isConnected) {
    void getSyncQueue().flush();
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
  credentials: { apiKey: string },  // (required) auth
  endpoint?: '/submit',             // route to POST data
  autoSync?: false,                 // auto-sync on reconnect
  onSyncSuccess?: 'keep',           // after sync: keep|delete|ttl
  ttl?: 7 * 24 * 60 * 60 * 1000,   // if ttl mode, keep duration
  duplicateStrategy?: 'append',     // append or overwrite
  payloadTransformer?: (r) => r,    // optional: shape before send
});
```

## How It Works

1. **Save** — Records written to AsyncStorage immediately
2. **Queue** — Each save queued for syncing
3. **Sync** — `flush()` POSTs all pending to your server
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
