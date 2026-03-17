export interface IStorageDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
  clear(): Promise<void>;
}
