# async-storage-sync

**Offline-first data layer for React Native** — save locally, sync to your server when connected.

## Install

```bash
npm install async-storage-sync @react-native-async-storage/async-storage @react-native-community/netinfo
```

## Quick Start

**1. Initialize once in `App.tsx`:**

```ts
import { initSyncQueue } from 'async-storage-sync';

initSyncQueue({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: {
    Authorization: 'Token abc123',
    'x-api-key': 'my-custom-key',
  },
  endpoint: '/submit',
  autoSync: true,
});
```

**2. Save data anywhere in your app:**

```ts
import { getSyncQueue } from 'async-storage-sync';

const store = getSyncQueue();

await store.save('submissions', {
  formId: '123',
  name: 'John',
  timestamp: new Date().toISOString(),
});
```

**3. Sync and check the result:**

```ts
const result = await store.flushWithResult('submissions');
console.log(`Synced: ${result.synced}, Failed: ${result.failed}, Remaining: ${result.remainingPending}`);
```

---

## Configuration

```ts
initSyncQueue({
  // required
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: {
    Authorization: 'Token abc123', // sent as-is in request headers
    'x-api-key': 'my-custom-key',  // any key/value pair works
  },
  endpoint: '/submit',

  // optional
  autoSync: true,                              // auto-flush on app open + reconnect (default: true)
  autoSyncCollections: ['submissions'],        // limit auto-sync to these collections; empty = all
  onSyncSuccess: 'delete',                     // what to do after a successful sync: 'keep' | 'delete' | 'ttl'
  ttl: 7 * 24 * 60 * 60 * 1000,              // used only when onSyncSuccess is 'ttl'
  duplicateStrategy: 'append',                 // 'append' (default) | 'overwrite'
  payloadTransformer: (record) => {            // strip internal fields before sending to server
    const { _id, _ts, _synced, _retries, ...payload } = record;
    return payload;
  },
});
```

> `credentials` values are merged directly into request headers. Any key/value pair is supported.

---

## API

### Setup

```ts
initSyncQueue(config)   // call once at app startup — safe to call again, won't re-init
getSyncQueue()          // get the instance anywhere in your app
```

### Write

```ts
store.save(collection, data, options?)  // save locally and enqueue for sync
```

`options` (all optional, override global config for this call only):

| Option | Values | Description |
|--------|--------|-------------|
| `type` | `string` | Labels the record — used by `overwrite` strategy to find and replace |
| `onSyncSuccess` | `'keep'` \| `'delete'` \| `'ttl'` | What happens to the local copy after sync |
| `duplicateStrategy` | `'append'` \| `'overwrite'` | Whether to add a new record or replace an existing one of the same `type` |

### Read

```ts
store.getAll(collection)        // all records in a collection
store.getById(collection, id)   // one record by its _id
```

### Delete

```ts
store.deleteById(collection, id)    // remove one record
store.deleteCollection(collection)  // wipe entire collection — call on logout
```

### Sync

```ts
store.flushWithResult(collection)           // sync one collection, get a result summary
store.syncManyWithResult(collections[])     // sync multiple collections, merged result summary
store.syncById(collection, id)              // sync one specific record
store.requeueFailed()                       // move 'failed' records back to pending for retry
```

**Result summary shape:**

```ts
{
  attempted, synced, failed, retried,
  deferred, networkErrors, remainingPending,
  skippedAlreadyFlushing, items
}
```

### Events

```ts
store.onSynced(callback)       // fires after each record syncs successfully
store.onAuthError(callback)    // fires on 401/403 — use to trigger re-login
store.onStorageFull(callback)  // fires when device storage is full
```

### Debug

```ts
store.getQueue()  // inspect the in-memory queue
store.destroy()   // stop engine, clear everything, reset singleton
```

---

## How It Works

1. `save()` writes the record to AsyncStorage immediately — no network needed.
2. The record is added to a queue with `_synced: 'pending'`.
3. On `flushWithResult()` (or automatically on reconnect if `autoSync: true`), queued records are POSTed to your server.
4. On `200 OK` — the record is marked synced, then kept/deleted based on `onSyncSuccess`.
5. On `5xx` — retried up to 5 times with exponential backoff.
6. On `4xx` — marked `failed`, never retried. Fires `onAuthError` on 401/403.
7. Everything persists across app restarts — the queue survives crashes.

---

## Stored Record Shape

Every saved record gets these fields added automatically:

```ts
{
  _id:      string   // uuid v4
  _ts:      number   // Date.now() at save time
  _synced:  'pending' | 'synced' | 'failed'
  _type:    string   // from save() options.type, or ''
  _retries: number   // sync attempt count

  ...yourData        // everything you passed to save()
}
```

---

## Limits

- Max 5 sync retries per record
- Not a full database — designed for queuing records, not complex queries
- Config is locked after `initSyncQueue()` is called

## Production Checklist

- [ ] Use `payloadTransformer` to strip `_` fields before they reach your server
- [ ] Handle `onAuthError` to catch expired tokens
- [ ] Call `deleteCollection()` on logout to clear user data
- [ ] Set `autoSyncCollections` to limit which collections sync automatically