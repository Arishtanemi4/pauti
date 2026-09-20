import { Migration } from './runner';
import { migration0001Initial } from './0001_initial';

export * from './runner';
export const migrations: readonly Migration[] = [migration0001Initial];
