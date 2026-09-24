// Wire format for the two QR flows this app uses (docs/architecture.md ADR-014): pairing
// (learn someone's device identity) and group invite (pairing plus enough to bootstrap a new
// group locally, src/db/queries/groups.ts's createGroupSkeleton). Pure encode/decode — the
// camera scan (expo-camera) and on-screen rendering (react-native-qrcode-svg) live in
// app/pair.tsx, the only file touching those.

export interface PairingPayload {
  v: 1;
  userId: string;
  deviceId: string;
  deviceName: string;
  displayName: string;
  publicKey: string; // base64 — decode with src/platform/crypto/sodium.ts's fromBase64
}

export interface GroupInvitePayload extends PairingPayload {
  groupId: string;
  crdtDocId: string;
  groupName: string;
  defaultCurrency: string;
  isPair: boolean;
}

export function encodePairingPayload(payload: PairingPayload): string {
  return JSON.stringify(payload);
}

export function encodeGroupInvitePayload(payload: GroupInvitePayload): string {
  return JSON.stringify(payload);
}

const PAIRING_FIELDS = ['v', 'userId', 'deviceId', 'deviceName', 'displayName', 'publicKey'] as const;
const INVITE_FIELDS = ['groupId', 'crdtDocId', 'groupName', 'defaultCurrency', 'isPair'] as const;

export function decodePairingPayload(text: string): PairingPayload {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a Pauti pairing QR code');
  }
  for (const field of PAIRING_FIELDS) {
    if (data[field] === undefined) throw new Error(`Invalid pairing QR code: missing ${field}`);
  }
  if (data.v !== 1) throw new Error(`Unsupported pairing QR version: ${data.v}`);
  return data as unknown as PairingPayload;
}

/** Same envelope as decodePairingPayload, plus the group fields carried by an invite QR. */
export function decodeGroupInvitePayload(text: string): GroupInvitePayload {
  const data = decodePairingPayload(text) as unknown as Record<string, unknown>;
  for (const field of INVITE_FIELDS) {
    if (data[field] === undefined) throw new Error(`Invalid invite QR code: missing ${field}`);
  }
  return data as unknown as GroupInvitePayload;
}

export function isGroupInvitePayload(payload: PairingPayload): payload is GroupInvitePayload {
  return 'groupId' in payload;
}

/** app/pair.tsx doesn't know ahead of time whether a scanned code is a plain pairing QR or a
 *  group invite — this decodes whichever it turns out to be. */
export function decodeScannedPayload(text: string): PairingPayload | GroupInvitePayload {
  try {
    return decodeGroupInvitePayload(text);
  } catch {
    return decodePairingPayload(text);
  }
}
