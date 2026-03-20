# async-storage-sync

Offline-first queue for React Native with type-safe payloads and automatic sync.

## Install

```bash
npm install async-storage-sync @react-native-async-storage/async-storage @react-native-community/netinfo
```

## Quick Start

```ts
import { initSyncQueue, getSyncQueue } from 'async-storage-sync';

await initSyncQueue({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: { Authorization: 'Token abc123' },
  endpoint: '/submit',
  idResolver: (item) => String(item.id ?? ''),
  autoSync: true,
});

type Submission = {
  id: string;
  formId: string;
  name: string;
};

const store = getSyncQueue().asType<Submission>();

const saved = await store.save('submissions', {
  id: 'sub_1',
  formId: 'form_a',
  name: 'John',
});

console.log(saved.meta.id);     // internal id used by queue
console.log(saved.data.name);   // your payload

const result = await store.flushWithResult();
console.log(`Synced: ${result.synced}, Failed: ${result.failed}`);
```

## What Changed

- Generic API: `save<T>()`, `getAll<T>()`, `getById<T>()`, `flushWithResult<T>()`.
- Metadata is separated from payload in storage and reads/writes.
- Identity is configurable with `idResolver`.
- `getSyncQueue()` is non-generic and safe on a singleton; use `asType<T>()` for typed access.

## Configuration

```ts
initSyncQueue({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: {
    Authorization: 'Token abc123',
    'x-api-key': 'my-custom-key',
  },

  endpoint: '/submit',
  autoSync: true,
  autoSyncCollections: ['submissions'],

  onSyncSuccess: 'delete',
  ttl: 7 * 24 * 60 * 60 * 1000,
  duplicateStrategy: 'append',

  idResolver: (item) => String(item.id ?? ''),
  payloadTransformer: (payload) => payload,
});
```

## API

### Setup

```ts
initSyncQueue(config)
getSyncQueue()
getTypedSyncQueue<T>()
```

### Typed access

```ts
type Invoice = { invoiceNo: string; amount: number };

const store = getSyncQueue().asType<Invoice>();

await store.save('invoices', { invoiceNo: 'INV-1', amount: 100 });
const all = await store.getAll('invoices');
const one = await store.getById('invoices', all[0].meta.id);
```

### Record shape

```ts
type StoredRecord<T> = {
  meta: {
    id: string;
    ts: number;
    synced: 'pending' | 'synced' | 'failed';
    type: string;
    retries: number;
  };
  data: T;
};
```

### Sync

```ts
const store = getSyncQueue().asType<{ amount: number }>();

await store.flushWithResult();
await getSyncQueue().syncWithResult('invoices');
await getSyncQueue().syncManyWithResult(['invoices', 'receipts']);
await getSyncQueue().syncById('invoices', 'record-id');
```

### Events

```ts
const queue = getSyncQueue();

queue.onSynced((item) => {
  console.log('Synced queue item:', item.id);
});

queue.onAuthError((statusCode, item) => {
  console.log('Auth error:', statusCode, item.recordId);
});

queue.onStorageFull(() => {
  console.log('Storage full');
});
```

## Notes

- `payloadTransformer` receives only your payload (`record.data`), not metadata.
- Queue payload and collection records are persisted across app restarts.
- Max 5 retries per record with exponential backoff for 5xx errors.