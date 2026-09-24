// LAN peer sync, Android (docs/plan/EXECUTE.md Phase 8.4, docs/architecture.md ADR-014). The
// only file that may import react-native-tcp-socket and expo-network — thin native I/O; the
// protocol itself (state-vector diffing, frame encryption) is in lanProtocol.ts, which is
// unit-tested directly since it has no native import to break under Vitest. This file is
// verified on-device instead (same convention as platform/sqlite.ts, platform/ocr.ts).
//
// Manual IP entry, not mDNS (docs/plan/EXECUTE.md Phase 8 decision): one device listens and
// shows its IP (getLocalIpAddress), the other dials it (connectToPeer). Both directions run the
// same handshake — hello, then a state-vector exchange, then each side sends the other whatever
// it's missing — so it doesn't matter which side is "server" for the sync outcome, only for who
// dials whom.

import TcpSocket from 'react-native-tcp-socket';
import * as Network from 'expo-network';
import { SqliteExecutor } from '../../db/migrations/runner';
import { ingestRemoteUpdate } from '../../crdt/sync';
import { fromBase64 } from '../crypto/sodium';
import {
  LanMessage,
  computeDiffsToSend,
  computeStateVectors,
  openFrame,
  persistStateVector,
  sealFrame,
} from './lanProtocol';

export const LAN_SYNC_PORT = 51820;

export async function getLocalIpAddress(): Promise<string> {
  return Network.getIpAddressAsync();
}

interface SyncParams {
  db: SqliteExecutor;
  myDeviceId: string;
  myPrivateKey: Uint8Array;
  peerPublicKey: Uint8Array;
  onStatus?: (status: string) => void;
}

/**
 * Runs the sync handshake over an already-connected socket, in either direction: send our state
 * vectors, send whatever the peer's vectors say it's missing, ingest whatever it sends us, and
 * stop once both sides have said `done`. Resolves once the socket sync is complete.
 */
function runSync(socket: TcpSocket.Socket, params: SyncParams): Promise<void> {
  const { db, myDeviceId, myPrivateKey, peerPublicKey, onStatus } = params;
  let buffer = '';
  let weAreDone = false;
  let peerIsDone = false;

  return new Promise((resolve, reject) => {
    const send = (message: LanMessage) => {
      socket.write(sealFrame(message, myDeviceId, peerPublicKey, myPrivateKey) + '\n');
    };

    const finishIfDone = () => {
      if (weAreDone && peerIsDone) {
        socket.end();
        resolve();
      }
    };

    const handleMessage = async (senderDeviceId: string, message: LanMessage) => {
      if (message.type === 'stateVectors') {
        const diffs = await computeDiffsToSend(db, message.vectors);
        for (const diff of diffs) send({ type: 'update', crdtDocId: diff.crdtDocId, payload: diff.payload });
        send({ type: 'done' });
        weAreDone = true;
        finishIfDone();
      } else if (message.type === 'update') {
        onStatus?.(`Receiving ${message.crdtDocId}...`);
        await ingestRemoteUpdate(db, message.crdtDocId, fromBase64(message.payload), senderDeviceId);
        await persistStateVector(db, message.crdtDocId);
      } else if (message.type === 'done') {
        peerIsDone = true;
        finishIfDone();
      }
    };

    socket.on('data', (data) => {
      buffer += typeof data === 'string' ? data : data.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        openFrame(line, db, myPrivateKey)
          .then(({ senderDeviceId, message }) => handleMessage(senderDeviceId, message))
          .catch(reject);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => {
      if (!(weAreDone && peerIsDone)) reject(new Error('LAN connection closed before sync finished.'));
    });

    onStatus?.('Exchanging state...');
    computeStateVectors(db).then((vectors) => send({ type: 'stateVectors', vectors }));
  });
}

/** The listening side: accepts one connection, syncs, then stops listening. */
export function startLanServer(params: SyncParams & { peerDeviceId: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = TcpSocket.createServer((socket) => {
      runSync(socket, params).then(resolve, reject).finally(() => server.close());
    });
    server.on('error', reject);
    server.listen({ port: LAN_SYNC_PORT, host: '0.0.0.0' });
  });
}

/** The connecting side: dials a peer at a manually-entered IP and syncs. */
export function connectToPeer(peerIp: string, params: SyncParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = TcpSocket.createConnection({ port: LAN_SYNC_PORT, host: peerIp }, () => {
      runSync(socket, params).then(resolve, reject);
    });
    socket.on('error', reject);
  });
}
