# AsyncStorage Sync — App Integration Guide

This guide shows how to use `async-storage-sync` in a React Native app (Expo or bare workflow).

## 1) Install

```bash
npm install async-storage-sync
npm install @react-native-async-storage/async-storage
npm install @react-native-community/netinfo
```

## 2) Initialize once at app startup

Initialize exactly once before using `getInstance()`.

```ts
// app/bootstrap/asyncStorageSync.ts
import { AsyncStorageSync } from 'async-storage-sync';

export async function initOfflineStore() {
  await AsyncStorageSync.init({
    driver: 'asyncstorage',
    serverUrl: 'https://api.example.com',
    credentials: { apiKey: 'YOUR_API_KEY' },
    endpoint: '/sync',
    onSyncSuccess: 'keep', // 'keep' | 'delete' | 'ttl'
    ttl: 7 * 24 * 60 * 60 * 1000,
    duplicateStrategy: 'append', // 'append' | 'overwrite'
  });
}
```

`credentials` are merged into request headers. You can either keep legacy `apiKey` or provide custom headers:

```ts
await AsyncStorageSync.init({
  driver: 'asyncstorage',
  serverUrl: 'https://api.example.com',
  credentials: {
    Authorization: 'Token abc123',
    'x-api-key': 'custom-key',
  },
});
```

Example usage in app entry:

```ts
// App.tsx
import React, { useEffect } from 'react';
import { initOfflineStore } from './app/bootstrap/asyncStorageSync';

export default function App() {
  useEffect(() => {
    void initOfflineStore();
  }, []);

  return null;
}
```

## 3) Access the singleton anywhere

```ts
import { AsyncStorageSync } from 'async-storage-sync';

const store = AsyncStorageSync.getInstance();
```

## 4) Save records (offline-first)

```ts
type Invoice = { amount: number; date: string };

await store.save<Invoice>('invoices', {
  amount: 99,
  date: '2026-01-01',
});
```

Per-call overrides:

```ts
await store.save('invoices', { amount: 120 }, {
  type: 'invoice',
  duplicateStrategy: 'overwrite',
  onSyncSuccess: 'delete',
});
```

## 5) Read and delete

```ts
const allInvoices = await store.getAll<{ amount: number; date: string }>('invoices');

const first = allInvoices[0];
if (first) {
  const one = await store.getById<{ amount: number; date: string }>('invoices', first._id);
  await store.deleteById('invoices', first._id);
}

await store.deleteCollection('old-invoices');
```

## 6) Sync APIs

```ts
// Sync everything and get summary output
const result = await store.flushWithResult();
console.log(result);

// Sync one collection and get summary output
const collectionResult = await store.syncWithResult('invoices');
console.log(collectionResult);

// Sync one specific record by id
await store.syncById('invoices', 'record-id');
```

## 7) Events / hooks

```ts
store.onSynced((item) => {
  console.log('Synced item:', item.id, item.key);
});

store.onAuthError((statusCode, item) => {
  console.log('Auth error:', statusCode, 'for queue item', item.id);
  // e.g. trigger token refresh/login flow
});

store.onStorageFull(() => {
  console.log('Storage full - free space or purge old collections');
});
```

## 8) Queue inspection (dev/debug)

```ts
const queue = store.getQueue();
console.log('Pending queue:', queue);
```

## 9) Recommended app pattern

- Initialize in app bootstrap.
- Use collection names by feature (`invoices`, `receipts`, `orders`).
- Use `flushWithResult()` for manual “Sync now” buttons when you need user-facing success/failure counts.
- Handle `onAuthError` globally for `401/403` recovery.
- Prefer `append` unless you explicitly want single-record-per-type behavior.

## 10) Test-friendly setup

In tests, initialize and reset per test:

```ts
import { AsyncStorageSync } from 'async-storage-sync';

beforeEach(async () => {
  try {
    const instance = AsyncStorageSync.getInstance();
    await instance.destroy();
  } catch {
    // not initialized yet
  }

  await AsyncStorageSync.init({
    driver: 'asyncstorage',
    serverUrl: 'https://api.example.com',
    credentials: { apiKey: 'test-key' },
  });
});
```

## 11) Cleanup (optional)

Use this for app logout flows or test teardown:

```ts
await store.destroy();
```

---

If you want, this guide can also be split into:
- Expo quickstart
- Bare React Native quickstart
- API reference by method
