import type { Unsubscribe } from '@tickdeck/core';
import { version } from '../package.json';

export const VERSION: string = version;

export interface SnapshotStore<T> {
  read(key: string): Promise<T | undefined>;
  write(key: string, value: T): Promise<void>;
  watch?(key: string, onChange: (value: T | undefined) => void): Unsubscribe;
}
