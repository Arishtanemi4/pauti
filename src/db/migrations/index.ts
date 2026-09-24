import { Migration } from './runner';
import { migration0001Initial } from './0001_initial';
import { migration0002Sync } from './0002_sync';

export * from './runner';
export const migrations: readonly Migration[] = [migration0001Initial, migration0002Sync];
