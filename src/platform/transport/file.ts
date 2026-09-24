// The only file that may import expo-file-system, expo-sharing and expo-document-picker for
// sync (docs/plan/EXECUTE.md Phase 8.3) — matches the "one file may import X" boundary
// platform/sqlite.ts and platform/crypto/sodium.ts already use. Thin native I/O only; the
// envelope format itself (build/encrypt/decrypt/ingest) lives in envelope.ts, which this
// re-exports so screens need only one import.
//
// (app/(tabs)/add.tsx also imports expo-file-system/expo-document-picker directly, but for
// statement import — an unrelated feature, not part of this sync boundary.)

import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

export * from './envelope';

/** Writes an envelope to a cache file and returns its uri, ready to hand to shareSyncFile. */
export async function writeSyncFile(envelopeJson: string, fileName: string): Promise<string> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(envelopeJson);
  return file.uri;
}

/** Hands the exported file to the OS share sheet (AirDrop, Bluetooth, a messaging app, ...). */
export async function shareSyncFile(fileUri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri);
  }
}

/** Opens the system file picker and returns the picked file's contents, or null if cancelled. */
export async function pickSyncFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
  if (result.canceled) return null;
  return new File(result.assets[0].uri).text();
}
