export type DriverName = 'asyncstorage';

export type OnSyncSuccess = 'keep' | 'delete' | 'ttl';

export type DuplicateStrategy = 'append' | 'overwrite';

export interface InitConfig {
  driver: DriverName;
  serverUrl: string;
  credentials: Record<string, string>;
  /**
   * Resolve a stable id for a payload. If omitted or the resolver returns an empty value,
   * a UUID will be generated.
   */
  idResolver?: (item: Record<string, unknown>) => string;
  /**
    * Optional transform applied to user payload (`record.data`) before it is sent to the server.
    * Use this to rename keys or reshape payload to match backend schema.
    * If omitted, payload is sent as-is.
   */
  payloadTransformer?: (record: Record<string, unknown>) => Record<string, unknown>;
  autoSync?: boolean;
  /**
   * If enabled, each successful save schedules a debounced best-effort sync.
   * This complements autoSync and does not replace connectivity-based triggers.
   */
  syncOnSave?: boolean;
  autoSyncCollections?: string[];
  endpoint?: string;
  onSyncSuccess?: OnSyncSuccess;
  ttl?: number;
  duplicateStrategy?: DuplicateStrategy;
}

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface RecordMeta {
  id: string;
  ts: number;
  synced: SyncStatus;
  type: string;
  retries: number;
}

export interface StoredRecord<T = Record<string, unknown>> {
  meta: RecordMeta;
  data: T;
}

export interface QueueItem {
  id: string;
  key: string;
  recordId: string;
  payload: string;
  endpoint: string;
  ts: number;
  retries: number;
  synced: boolean;
}

export interface SaveOptions {
  type?: string;
  onSyncSuccess?: OnSyncSuccess;
  duplicateStrategy?: DuplicateStrategy;
}

export type FlushItemStatus =
  | 'synced'
  | 'failed'
  | 'retried'
  | 'deferred-backoff'
  | 'network-error';

export interface FlushItemResult<T = Record<string, unknown>> {
  itemId: string;
  collection: string;
  recordId: string;
  status: FlushItemStatus;
  httpStatus?: number;
  record?: StoredRecord<T>;
}

export interface FlushResult<T = Record<string, unknown>> {
  attempted: number;
  synced: number;
  failed: number;
  retried: number;
  deferred: number;
  networkErrors: number;
  remainingPending: number;
  skippedAlreadyFlushing: boolean;
  items: Array<FlushItemResult<T>>;
}

export type SyncedCallback = (item: QueueItem) => void;
export type AuthErrorCallback = (statusCode: number, item: QueueItem) => void;
export type StorageFullCallback = () => void;

/** Fully resolved config with all required fields filled in (payloadTransformer stays optional) */
export type ResolvedConfig = Required<
  Omit<InitConfig, 'payloadTransformer' | 'autoSyncCollections' | 'idResolver'>
> &
  Pick<InitConfig, 'payloadTransformer' | 'autoSyncCollections' | 'idResolver'>;

export interface SyncStore<T extends Record<string, unknown>> {
  save(collection: string, item: T, options?: SaveOptions): Promise<StoredRecord<T>>;
  getAll(collection: string): Promise<Array<StoredRecord<T>>>;
  getById(collection: string, id: string): Promise<StoredRecord<T> | null>;
  flushWithResult(): Promise<FlushResult<T>>;
}
