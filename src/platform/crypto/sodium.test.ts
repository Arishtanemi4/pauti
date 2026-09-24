import { describe, expect, it, beforeAll } from 'vitest';
import { box, fromBase64, generateKeypair, openBox, ready, toBase64 } from './sodium';

describe('sodium', () => {
  beforeAll(ready);

  it('round-trips a message between two keypairs', () => {
    const sender = generateKeypair();
    const recipient = generateKeypair();
    const message = new TextEncoder().encode('pauti phase 8');

    const sealed = box(message, recipient.publicKey, sender.privateKey);
    const opened = openBox(sealed, sender.publicKey, recipient.privateKey);

    expect(new TextDecoder().decode(opened)).toBe('pauti phase 8');
  });

  it('rejects decryption with the wrong keypair', () => {
    const sender = generateKeypair();
    const recipient = generateKeypair();
    const impostor = generateKeypair();
    const sealed = box(new TextEncoder().encode('secret'), recipient.publicKey, sender.privateKey);

    expect(() => openBox(sealed, impostor.publicKey, recipient.privateKey)).toThrow();
  });

  it('round-trips bytes through base64', () => {
    const { publicKey } = generateKeypair();
    expect(fromBase64(toBase64(publicKey))).toEqual(publicKey);
  });
});
