// §1.3: web gets a throwing stub, not a silent no-op — the gap is explicit and type-checked.
// LAN sync (react-native-tcp-socket) is Android-only; see lan.ts for the real implementation.

export const LAN_SYNC_PORT = 51820;

export async function getLocalIpAddress(): Promise<never> {
  throw new Error('LAN sync is not implemented on web');
}

export function startLanServer(_params: unknown): Promise<never> {
  throw new Error('LAN sync is not implemented on web');
}

export function connectToPeer(_peerIp: string, _params: unknown): Promise<never> {
  throw new Error('LAN sync is not implemented on web');
}
