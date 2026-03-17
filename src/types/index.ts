export type DriverName = 'asyncstorage';

export type OnSyncSuccess = 'keep' | 'delete' | 'ttl';

export type DuplicateStrategy = 'append' | 'overwrite';

export interface InitConfig {
  driver: DriverName;
  serverUrl: string;
  credentials: {
    apiKey: string;
  };
  /**
   * Optional transform applied to the stored record before it is sent to the server.
   * Use this to strip internal meta fields, rename keys, or reshape the payload
   * to match your backend's expected schema.
   * If omitted, the full stored record is sent as-is.
   */
  payloadTransformer?: (record: Record<string, unknown>) => Record<string, unknown>;
  autoSync?: boolean;
  endpoint?: string;
  onSyncSuccess?: OnSyncSuccess;
  ttl?: number;
  duplicateStrategy?: DuplicateStrategy;
}

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface RecordMeta {
  _id: string;
  _ts: number;
  _synced: SyncStatus;
  _type: string;
  _retries: number;
}

export type StoredRecord<T = Record<string, unknown>> = RecordMeta & T;

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

export type SyncedCallback = (item: QueueItem) => void;
export type AuthErrorCallback = (statusCode: number, item: QueueItem) => void;
export type StorageFullCallback = () => void;

/** Fully resolved config with all required fields filled in (payloadTransformer stays optional) */
export type ResolvedConfig = Required<Omit<InitConfig, 'payloadTransformer'>> & Pick<InitConfig, 'payloadTransformer'>;
