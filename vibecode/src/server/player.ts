import type { Socket } from 'node:net';
import type { SavedPlayer } from '../world/world';

export type ConnectionState = 'pre-login' | 'login' | 'joined';

export interface PlayerConnection {
  socket: Socket;
  state: ConnectionState;
  transportBuffer: Buffer;
  packetBuffer: Buffer;
  smallId: number;
  playerIndex: number;
  entityId: number;
  gameMode: 0 | 1 | 2;
  localXuid: bigint;
  packetWindowStartedAt: number;
  packetWindowCount: number;
  player: SavedPlayer | undefined;
  world: import('../world/world').World | undefined;
  breakTarget: { x: number; y: number; z: number } | undefined;
  chunksSent: Set<string>;
}

export function createInventory(): SavedPlayer['inventory'] {
  const inventory: SavedPlayer['inventory'] = Array.from({ length: 36 }, () => null);
  inventory[0] = { id: 1, count: 64, damage: 0 };
  inventory[1] = { id: 3, count: 64, damage: 0 };
  inventory[2] = { id: 5, count: 64, damage: 0 };
  inventory[3] = { id: 20, count: 64, damage: 0 };
  inventory[4] = { id: 12, count: 64, damage: 0 };
  return inventory;
}

export function createPlayer(name: string, previous?: SavedPlayer): SavedPlayer {
  if (previous) {
    return {
      ...previous,
      name,
      inventory: previous.inventory.map((stack) => (stack ? { ...stack } : null)),
    };
  }
  return {
    name,
    x: 0.5,
    y: 4,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    inventory: createInventory(),
  };
}

export function snapshotPlayer(player: SavedPlayer): SavedPlayer {
  return {
    ...player,
    inventory: player.inventory.map((stack) => (stack ? { ...stack } : null)),
  };
}
