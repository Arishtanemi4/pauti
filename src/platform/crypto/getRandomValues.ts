// Replaces lib0's "react-native" webcrypto shim (see metro.config.js), which resolves to
// the abandoned `isomorphic-webcrypto` package — last published 2022, depending on
// `expo-random` and `@unimodules/*`, both removed from Expo SDKs years ago. Its browser
// variant (lib0/webcrypto.js) is a two-line wrapper around a global `crypto`; this supplies
// that global's `getRandomValues` directly, with no native module needed.
//
// This is only ever reached via lib0/random.js, which uses it to generate CRDT client IDs
// and uuids — collision-avoidance, not cryptographic secrecy. Real security-sensitive
// randomness (device keypairs, Phase 8) goes through a libsodium binding, not this file.

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return array;
}

export const subtle: never = undefined as never;
