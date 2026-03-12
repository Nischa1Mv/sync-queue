# sync-queue

A framework-agnostic, storage-agnostic offline-first sync queue for React Native.

Store data locally first. Sync to your backend automatically when internet returns.

---

## Features

- **Auto-syncs** when internet is restored — no manual trigger needed
- **Pluggable storage** — AsyncStorage, MMKV, SQLite, or your own adapter
- **Pluggable network** — NetInfo or any connectivity source
- **Payload validation** — reject bad data before it enters the queue
- **Conflict resolution** — client-wins, server-wins, or manual strategies
- **Retry with backoff** — configurable attempts and delay per item
- **Concurrency control** — prevents timeout on large queues
- **React hooks** — `useQueue`, `useSyncQueue`, `useNetworkStatus`
- **Full TypeScript** — everything is typed end-to-end
- **Zero assumptions** — you own the HTTP logic, auth, and endpoints

---

## Install

```bash
npm install sync-queue
```

Peer dependencies — install whichever you use:

```bash
npm install @react-native-async-storage/async-storage
npm install @react-native-community/netinfo
# or: npm install react-native-mmkv
```

---

## Table of Contents

- [Quickstart](#quickstart)
- [How It Works](#how-it-works)
- [File Structure](#file-structure)
- [Storage Adapters](#storage-adapters)
- [Network Adapters](#network-adapters)
- [Payload Validation](#payload-validation)
- [Conflict Resolution](#conflict-resolution)
- [Retry Policy](#retry-policy)
- [Hooks API](#hooks-api)
- [Using SyncQueue Directly](#using-syncqueue-directly)
- [Multiple Queues](#multiple-queues)
- [QueueItem Shape](#queueitem-shape)
- [Full Config Reference](#full-config-reference)
- [Testing](#testing)
- [Architecture](#architecture)

---

## Quickstart

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useSyncQueue, AsyncStorageAdapter, NetInfoAdapter } from 'sync-queue';

type FormPayload = { formName: string; data: Record<string, unknown> };

function useFormQueue() {
  return useSyncQueue<FormPayload>({
    storage: new AsyncStorageAdapter(AsyncStorage),
    network: new NetInfoAdapter(NetInfo),

    async onSync({ item, attempt }) {
      const res = await fetch('https://api.myapp.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      });

      if (res.ok) return { status: 'success' };

      const err = await res.json();
      // retry: true = try again. retry: false = mark permanently failed
      return { status: 'failure', error: err.message, retry: res.status >= 500 };
    },
  });
}
```

Then in any component:

```tsx
function FormScreen() {
  const { add, pendingItems, failedItems, isSyncing, isConnected } = useFormQueue();

  const handleSubmit = async (formData) => {
    // Saves locally immediately.
    // If online → auto-syncs in background.
    // If offline → queues until internet returns.
    await add({ payload: { formName: 'CustomerForm', data: formData } });
  };

  return (
    <>
      <Text>{isConnected ? '🟢 Online' : '🔴 Offline'}</Text>
      <Text>{pendingItems.length} items waiting to sync</Text>
      {failedItems.map(item => (
        <Text key={item.id}>❌ {item.errorMessage}</Text>
      ))}
      <Button title="Submit Form" onPress={() => handleSubmit(data)} />
    </>
  );
}
```

---

## How It Works

### The flow end to end

```
1. User fills form → app calls add({ payload })
      └─ validates payload (if validator provided)
      └─ creates QueueItem { id, status: 'pending', attemptCount: 0 }
      └─ writes to AsyncStorage / MMKV
      └─ if online → triggers syncAll() automatically
      └─ React state updates: pendingCount goes up

2a. Device is online → syncAll() fires:
      └─ reads pending items from storage
      └─ batches them (max `concurrency` at a time, default 5)
      └─ calls YOUR onSync({ item }) for each
      └─ you return { status: 'success' }
      └─ item removed from storage
      └─ React state updates: pendingCount goes down

2b. Device is offline → item sits in storage
      └─ NetInfoAdapter fires when internet returns
      └─ SyncQueue catches it → calls syncAll() automatically
      └─ same flow as 2a

3. onSync returns failure:
      └─ attemptCount++
      └─ if attempts < maxAttempts → schedules retry after delayMs
      └─ if attempts exhausted → status: 'failed', errorMessage set
      └─ React state: item moves from pendingItems → failedItems

4. User taps retry:
      └─ app calls resetItem(id) or syncOne(id)
      └─ status resets to 'pending', errorMessage cleared
      └─ syncOne fires immediately
```

### What the library owns vs what you own

| Library owns | You own |
|---|---|
| Queue storage and reads | HTTP fetch logic |
| Network listener + auto-sync | Auth tokens |
| Retry scheduling and counting | API endpoint URLs |
| Conflict resolution strategies | Response parsing |
| React state updates | Validation rules |
| Concurrency batching | Error messages |

---

## File Structure

```
sync-queue/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
│
├── src/
│   ├── index.ts                       # Public API — re-exports only
│   │
│   ├── types/
│   │   └── index.ts                   # All TS interfaces and types
│   │                                  # Zero imports. Everything else imports from here.
│   │
│   ├── core/
│   │   ├── SyncQueue.ts               # Main class — owns everything
│   │   └── QueueStore.ts              # Raw read/write on persisted queue
│   │                                  # No React, no network. Pure storage logic.
│   │
│   ├── adapters/
│   │   ├── AsyncStorageAdapter.ts     # For @react-native-async-storage
│   │   ├── MMKVAdapter.ts             # For react-native-mmkv
│   │   └── NetworkAdapters.ts         # NetInfoAdapter + MemoryNetworkAdapter
│   │
│   ├── hooks/
│   │   └── index.ts                   # useQueue, useSyncQueue, useNetworkStatus
│   │                                  # Only layer that imports React
│   │
│   └── utils/
│       ├── nanoid.ts                  # ID generation (no external dep)
│       └── sleep.ts                   # Promise delay for retry backoff
│
└── __tests__/
    ├── QueueStore.test.ts
    ├── SyncQueue.test.ts
    ├── adapters.test.ts
    ├── hooks.test.ts
    └── useNetworkStatus.test.ts
```

### Layer rules

- `types/` has **zero imports** — everything else imports from it, never the reverse
- `core/` imports from `types/` and `utils/` only — no React, no adapters
- `adapters/` imports from `types/` only — implements the interfaces, nothing more
- `hooks/` is the **only layer that imports React** — sits on top of `core/`
- `index.ts` is **purely re-exports** — no logic lives there

This means your core sync logic is 100% testable in plain Node.js — no React Native environment needed.

---

## Storage Adapters

### AsyncStorage

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AsyncStorageAdapter } from 'sync-queue';

const storage = new AsyncStorageAdapter(AsyncStorage);
```

### MMKV (faster, recommended)

```tsx
import { MMKV } from 'react-native-mmkv';
import { MMKVAdapter } from 'sync-queue';

const storage = new MMKVAdapter(new MMKV());
```

### Custom adapter

Implement the `StorageAdapter` interface — just 3 methods:

```ts
import type { StorageAdapter } from 'sync-queue';

class MyAdapter implements StorageAdapter {
  async getItem<T>(key: string): Promise<T | null> {
    // read and JSON.parse
  }
  async setItem<T>(key: string, value: T): Promise<void> {
    // JSON.stringify and write
  }
  async removeItem(key: string): Promise<void> {
    // delete
  }
}
```

---

## Network Adapters

### NetInfo

```tsx
import NetInfo from '@react-native-community/netinfo';
import { NetInfoAdapter } from 'sync-queue';

const network = new NetInfoAdapter(NetInfo);
```

### Custom adapter

```ts
import type { NetworkAdapter } from 'sync-queue';

class MyNetwork implements NetworkAdapter {
  async isConnected(): Promise<boolean> {
    // return current connectivity
  }
  onConnectivityChange(cb: (connected: boolean) => void): () => void {
    // subscribe and return unsubscribe fn
  }
}
```

### MemoryNetworkAdapter (for testing)

```ts
import { MemoryNetworkAdapter } from 'sync-queue';

const network = new MemoryNetworkAdapter(true); // starts online
network.setConnected(false); // simulate going offline
network.setConnected(true);  // simulate coming back online
```

---

## Payload Validation

Provide a `validator` — called before storing. Invalid items are **never saved to the queue**.

### With Zod

```ts
import { z } from 'zod';

const schema = z.object({
  formName: z.string().min(1),
  data: z.record(z.unknown()),
});

useSyncQueue({
  validator: (payload) => {
    const result = schema.safeParse(payload);
    return result.success
      ? { valid: true }
      : { valid: false, errors: result.error.issues.map(i => i.message) };
  },
  ...
});
```

### Custom function

```ts
validator: (payload) => {
  const p = payload as MyPayload;
  if (!p.formName) return { valid: false, errors: ['formName is required'] };
  return { valid: true };
}
```

### Catching validation errors

```ts
import { ValidationError } from 'sync-queue';

try {
  await add({ payload: badData });
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.errors); // ['formName is required']
  }
}
```

---

## Conflict Resolution

Return `{ status: 'conflict' }` from `onSync` when your server signals a conflict
(e.g. the record was modified by someone else).

```ts
async onSync({ item }) {
  const res = await fetch('/submit', { ... });
  const data = await res.json();

  if (data.conflict) {
    return {
      status: 'conflict',
      resolution: {
        strategy: 'client-wins',
        resolvedPayload: { ...item.payload, ...data.serverFields },
        reason: 'Record modified by another user',
      },
    };
  }

  return { status: 'success' };
}
```

### Strategies

| Strategy | What happens |
|---|---|
| `client-wins` | Removes old item, re-enqueues with `resolvedPayload`. Default. |
| `server-wins` | Discards the item. Server version wins. |
| `manual` | Marks item as `failed` with conflict message. Your UI handles it. |

```ts
useSyncQueue({
  conflictStrategy: 'server-wins', // default for all conflicts

  onConflict: (item, resolution) => {
    // Always fires regardless of strategy — use for logging or UI
    console.log(`Conflict on ${item.id}: ${resolution.reason}`);
  },
});
```

---

## Retry Policy

```ts
useSyncQueue({
  retryPolicy: {
    maxAttempts: 5,                            // default: 3
    delayMs: (attempt) => attempt * 2000,      // default: exponential (1s, 2s, 4s...)
    retryOnReconnect: true,                    // default: true — waits for network
  },
});
```

Control retry per item from `onSync`:

```ts
async onSync({ item, attempt }) {
  const res = await fetch(...);
  if (!res.ok) {
    return {
      status: 'failure',
      error: 'Server error',
      retry: res.status >= 500,  // only retry 5xx, not 4xx
    };
  }
  return { status: 'success' };
}
```

---

## Hooks API

### `useSyncQueue(config)`

All-in-one hook. Creates and owns the `SyncQueue` instance internally.
Best for most apps — no need to manage the queue instance yourself.

```tsx
const {
  items,           // QueueItem[] — all items
  pendingItems,    // QueueItem[] — status: pending or syncing
  failedItems,     // QueueItem[] — status: failed
  pendingCount,    // number — badge count
  isLoading,       // boolean — first load from storage
  isSyncing,       // boolean — sync in progress
  isConnected,     // boolean — network status
  lastSyncResult,  // SyncResult | null

  add,             // (input) => Promise<QueueItem>
  syncAll,         // () => Promise<SyncResult>
  syncOne,         // (id) => Promise<SyncResult>
  resetItem,       // (id) => Promise<void>
  resetAllFailed,  // () => Promise<void>
  removeItem,      // (id) => Promise<void>
  clearAll,        // () => Promise<void>
} = useSyncQueue(config);
```

### `useQueue(queue)`

Subscribe to an existing `SyncQueue` instance.
Use when you create the queue outside React (e.g. in a service singleton).

```ts
// services/formQueue.ts
export const formQueue = new SyncQueue({ ... });

// components/QueueScreen.tsx
import { useQueue } from 'sync-queue';
import { formQueue } from '../services/formQueue';

const { items, syncAll, failedItems } = useQueue(formQueue);
```

Returns the same fields as `useSyncQueue`.

### `useNetworkStatus(network)`

Standalone connectivity hook. Use for UI banners, disabled states, etc.

```tsx
import { useNetworkStatus, NetInfoAdapter } from 'sync-queue';
import NetInfo from '@react-native-community/netinfo';

const { isConnected } = useNetworkStatus(new NetInfoAdapter(NetInfo));

return <Banner visible={!isConnected} message="You are offline" />;
```

---

## Using SyncQueue Directly

If you need to use the queue outside React (e.g. in a background service):

```ts
import { SyncQueue } from 'sync-queue';

const queue = new SyncQueue({
  storage: new AsyncStorageAdapter(AsyncStorage),
  network: new NetInfoAdapter(NetInfo),
  onSync: async ({ item }) => { ... },
});

// Add item
const item = await queue.add({ payload: { ... } });

// Manual sync
const result = await queue.syncAll();
console.log(result.succeeded.length, 'synced');
console.log(result.failed.length, 'failed');

// Read queue
const all     = await queue.getAll();
const pending = await queue.getPending();
const failed  = await queue.getFailed();

// Reset failed items
await queue.resetAllFailed();

// Subscribe to changes (for manual UI updates)
const unsubscribe = queue.subscribe(() => {
  console.log('queue changed');
});

// Always call destroy when done — unsubscribes network listener
queue.destroy();
```

---

## Multiple Queues

Use different `storageKey` values to keep queues isolated in the same app:

```ts
const formQueue = new SyncQueue({
  storageKey: '@app/form-queue',
  ...
});

const photoQueue = new SyncQueue({
  storageKey: '@app/photo-queue',
  ...
});
```

---

## QueueItem Shape

```ts
interface QueueItem<TPayload> {
  id: string;                          // auto-generated nanoid
  payload: TPayload;                   // your data, untouched
  status: 'pending'                    // waiting to sync
        | 'syncing'                    // currently in-flight
        | 'failed'                     // permanently failed
        | 'success';                   // removed on success
  createdAt: number;                   // unix ms timestamp
  attemptedAt?: number;                // last attempt timestamp
  attemptCount: number;                // total attempts made
  errorMessage?: string;               // last error message
  meta?: Record<string, unknown>;      // arbitrary metadata (userId, tag, etc.)
}
```

---

## Full Config Reference

```ts
interface SyncQueueConfig<TPayload> {
  // Required
  storage: StorageAdapter;             // where to persist the queue
  network: NetworkAdapter;             // connectivity source
  onSync: SyncHandler<TPayload>;       // your sync logic, called per item

  // Storage
  storageKey?: string;                 // default: '@sync-queue/items'

  // Concurrency
  concurrency?: number;                // max parallel requests. default: 5

  // Validation
  validator?: PayloadValidator<TPayload>;

  // Conflict
  conflictStrategy?: 'client-wins'     // re-enqueue with resolvedPayload (default)
                   | 'server-wins'     // discard item
                   | 'manual';         // mark failed, app handles it
  onConflict?: (item, resolution) => void;

  // Retry
  retryPolicy?: {
    maxAttempts?: number;              // default: 3
    delayMs?: (attempt: number) => number; // default: exponential backoff
    retryOnReconnect?: boolean;        // default: true
  };

  // Callbacks
  onSuccess?: (item: QueueItem<TPayload>) => void;
  onFailure?: (item: QueueItem<TPayload>, error: string) => void;
}
```

### `onSync` return values

```ts
// Success — item removed from queue
return { status: 'success' };

// Failure — item retried or marked failed
return { status: 'failure', error: 'message', retry: true };

// Conflict — resolution strategy applied
return {
  status: 'conflict',
  resolution: {
    strategy: 'client-wins',           // or 'server-wins' or 'manual'
    resolvedPayload: mergedData,        // used by client-wins
    reason: 'human readable reason',
  },
};
```

---

## Testing

The library uses [Vitest](https://vitest.dev/).

```bash
# Install test deps
npm install -D vitest @testing-library/react-hooks react-test-renderer

# Run all tests
npx vitest run

# Watch mode
npx vitest

# Coverage
npx vitest run --coverage
```

### Test files

| File | What it tests | Cases |
|---|---|---|
| `QueueStore.test.ts` | Raw storage read/write, key isolation | 20 |
| `SyncQueue.test.ts` | Sync flow, retry, conflict, auto-sync, concurrency | 35 |
| `adapters.test.ts` | AsyncStorage, MMKV, MemoryNetworkAdapter | 27 |
| `hooks.test.ts` | useQueue and useSyncQueue React state | 20 |
| `useNetworkStatus.test.ts` | Network hook subscribe/unsubscribe | 8 |

### Testing strategy

All tests use plain in-memory fakes — no mocking of AsyncStorage, no device required, runs in pure Node.js.

```ts
// Instead of real AsyncStorage
function makeMemoryStorage() {
  const store = new Map<string, string>();
  return {
    async getItem<T>(key: string) { ... },
    async setItem<T>(key: string, value: T) { ... },
    async removeItem(key: string) { ... },
  };
}

// Instead of real NetInfo
const network = new MemoryNetworkAdapter(false); // starts offline
network.setConnected(true);                      // simulate reconnect
```

---

## Architecture

```
Your App
   │
   ▼
useSyncQueue() / useQueue()        ← React hooks (hooks/index.ts)
   │
   ▼
SyncQueue                          ← Brain (core/SyncQueue.ts)
   │
   ├── QueueStore                  ← Storage I/O (core/QueueStore.ts)
   │       └── StorageAdapter      ← AsyncStorage / MMKV / custom
   │
   ├── NetworkAdapter              ← NetInfo / Memory / custom
   │
   └── onSync()                    ← YOUR function — library calls it
```

### Dependency flow (no circular imports)

```
types/         ← imported by everything, imports nothing
utils/         ← imported by core/ only
adapters/      ← imports types/ only
core/          ← imports types/, utils/
hooks/         ← imports core/, types/ (only layer with React)
index.ts       ← re-exports everything, no logic
```