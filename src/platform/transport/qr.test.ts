import { describe, expect, it } from 'vitest';
import {
  GroupInvitePayload,
  PairingPayload,
  decodeGroupInvitePayload,
  decodePairingPayload,
  decodeScannedPayload,
  encodeGroupInvitePayload,
  encodePairingPayload,
  isGroupInvitePayload,
} from './qr';

const pairing: PairingPayload = {
  v: 1,
  userId: 'usr_bob',
  deviceId: 'dev_bob',
  deviceName: "Bob's phone",
  displayName: 'Bob',
  publicKey: 'AQIDBA==',
};

const invite: GroupInvitePayload = {
  ...pairing,
  groupId: 'grp_trio',
  crdtDocId: 'crdt_grp_trio',
  groupName: 'Trio',
  defaultCurrency: 'INR',
  isPair: false,
};

describe('pairing payload', () => {
  it('round-trips through encode/decode', () => {
    expect(decodePairingPayload(encodePairingPayload(pairing))).toEqual(pairing);
  });

  it('rejects non-JSON input', () => {
    expect(() => decodePairingPayload('not json')).toThrow('Not a Pauti pairing QR code');
  });

  it('rejects a payload missing a required field', () => {
    const { publicKey, ...rest } = pairing;
    expect(() => decodePairingPayload(JSON.stringify(rest))).toThrow(/missing publicKey/);
  });

  it('rejects an unsupported version', () => {
    expect(() => decodePairingPayload(JSON.stringify({ ...pairing, v: 2 }))).toThrow(/Unsupported pairing QR version/);
  });
});

describe('group invite payload', () => {
  it('round-trips through encode/decode', () => {
    expect(decodeGroupInvitePayload(encodeGroupInvitePayload(invite))).toEqual(invite);
  });

  it('rejects a payload missing a group field', () => {
    const { groupId, ...rest } = invite;
    expect(() => decodeGroupInvitePayload(JSON.stringify(rest))).toThrow(/missing groupId/);
  });

  it('isGroupInvitePayload distinguishes the two shapes', () => {
    expect(isGroupInvitePayload(pairing)).toBe(false);
    expect(isGroupInvitePayload(invite)).toBe(true);
  });
});

describe('decodeScannedPayload', () => {
  it('decodes a plain pairing QR as a pairing payload', () => {
    expect(decodeScannedPayload(encodePairingPayload(pairing))).toEqual(pairing);
  });

  it('decodes an invite QR as a group invite payload', () => {
    expect(decodeScannedPayload(encodeGroupInvitePayload(invite))).toEqual(invite);
  });

  it('rejects garbage the same way decodePairingPayload does', () => {
    expect(() => decodeScannedPayload('not json')).toThrow('Not a Pauti pairing QR code');
  });
});
