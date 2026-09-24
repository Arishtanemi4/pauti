// The only file that may import react-native-libsodium (matches the "one file may import X"
// boundary sqlite.ts/ocr.ts/pdf.ts already use). X25519 crypto_box gives authenticated
// public-key encryption in one primitive — a decrypted message proves it came from the
// claimed sender's private key, so device identity (docs/architecture.md ADR-014) needs no
// separate signing keypair.
//
// Runs on Android, iOS and web (WASM fallback) — unlike getRandomValues.ts's Hermes/WASM
// problem (ADR-002), that only ruled out WASM as a *CRDT* dependency loaded on every app
// start; here it's an opt-in dependency only touched by sync code.

import sodium from 'react-native-libsodium';

export interface BoxKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface Sealed {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export async function ready(): Promise<void> {
  await sodium.ready;
}

export function generateKeypair(): BoxKeypair {
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  return { publicKey, privateKey };
}

/** Authenticated public-key encryption: only `recipientPublicKey`'s holder can decrypt, and a
 *  successful decrypt proves the message came from `senderPrivateKey`'s holder. */
export function box(message: Uint8Array, recipientPublicKey: Uint8Array, senderPrivateKey: Uint8Array): Sealed {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(message, nonce, recipientPublicKey, senderPrivateKey);
  return { ciphertext, nonce };
}

export function openBox(
  sealed: Sealed,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  return sodium.crypto_box_open_easy(sealed.ciphertext, sealed.nonce, senderPublicKey, recipientPrivateKey);
}

// Re-exported so callers (QR payloads, sync-file envelopes, key storage) never need their own
// import of react-native-libsodium just to move bytes through JSON or expo-secure-store.
export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes);
}

export function fromBase64(text: string): Uint8Array {
  return sodium.from_base64(text);
}
