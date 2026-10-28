import { BufferReader, BufferWriter, IncompletePacketError } from './binary';
import {
  buildChunkPacket as buildChunkUpdate,
  CHUNK_SIZE,
  type Chunk,
  FLAT_SURFACE_Y,
  WORLD_HEIGHT,
} from './world/chunk';
import type { InventoryStack, SavedPlayer } from './world/world';
import { inventoryMenuContents, menuSlotFromStorageIndex } from './server/inventory';

export const NETWORK_PROTOCOL_VERSION = 79;
export const NETCODE_VERSION = 571;
export const MAX_PLAYER_NAME_LENGTH = 16;

export interface ItemStackPacket {
  id: number;
  count: number;
  damage: number;
}

export interface ClientPacket {
  id: number;
  bytesRead: number;
  unsupported?: boolean;
  clientVersion?: number;
  netcodeVersion?: number;
  username?: string;
  loginKey?: string;
  position?: { x: number; y: number; yView: number; z: number };
  rotation?: { yaw: number; pitch: number };
  action?: number;
  blockX?: number;
  blockY?: number;
  blockZ?: number;
  face?: number;
  item?: ItemStackPacket | null;
  selectedSlot?: number;
  creativeSlot?: number;
  chat?: string;
  keepAliveId?: number;
  disconnected?: boolean;
  customPayload?: { channel: string; data: Buffer };
}

export { IncompletePacketError };

export function buildPreLoginPacket(): Buffer {
  return new BufferWriter()
    .byte(2)
    .short(NETCODE_VERSION)
    .utf('-')
    .byte(0)
    .int(0)
    .byte(0)
    .bytes(Buffer.alloc(14))
    .int(0)
    .byte(0)
    .int(0)
    .build();
}

export function buildLoginPacket(
  maxPlayers: number,
  playerIndex: number,
  seed: bigint,
  dimension = 0,
  gameMode = 0,
  privileges = 0,
): Buffer {
  return new BufferWriter()
    .byte(1)
    .int(NETWORK_PROTOCOL_VERSION)
    .utf('')
    .utf('flat')
    .long(seed)
    .int(gameMode)
    .byte(dimension)
    .byte(WORLD_HEIGHT & 0xff)
    .byte(maxPlayers)
    .long(0n)
    .long(0n)
    .bool(false)
    .int(0)
    .byte(1)
    .int(0)
    .byte(playerIndex)
    .int(0)
    .int(0)
    .bool(false)
    .bool(false)
    .int(privileges)
    .short(320)
    .byte(8)
    .build();
}

export function buildInitialStatePackets(
  maxPlayers: number,
  playerIndex: number,
  seed: bigint,
  player: SavedPlayer,
  dimension = 0,
  gameMode = 0,
  privileges = 0,
): Buffer {
  const spawnY = FLAT_SURFACE_Y + 1;
  return Buffer.concat([
    buildLoginPacket(maxPlayers, playerIndex, seed, dimension, gameMode, privileges),
    new BufferWriter().byte(6).int(0).int(spawnY).int(0).build(),
    new BufferWriter().byte(202).byte(0).float(0.05).float(0.1).build(),
    new BufferWriter().byte(8).float(20).short(20).float(5).byte(0).build(),
    new BufferWriter().byte(16).short(player.selectedSlot).build(),
    buildInventoryPacket(player.inventory),
    new BufferWriter().byte(4).long(0n).long(6000n).build(),
    buildPlayerPositionPacket(player),
  ]);
}

export function buildInventoryPacket(inventory: Array<InventoryStack | null>): Buffer {
  const contents = inventoryMenuContents(inventory);
  const writer = new BufferWriter().byte(104).byte(0).short(contents.length);
  for (const stack of contents) writeItem(writer, stack);
  return writer.build();
}

export function buildInventorySlotPacket(slot: number, stack: InventoryStack | null): Buffer {
  const writer = new BufferWriter().byte(103).byte(0).short(menuSlotFromStorageIndex(slot));
  writeItem(writer, stack);
  return writer.build();
}

export function buildChunkPacket(chunk: Chunk, visible = true): Buffer {
  return buildChunkUpdate(chunk, visible);
}

export function buildTileUpdatePacket(x: number, y: number, z: number, blockId: number, metadata = 0): Buffer {
  return new BufferWriter()
    .byte(53)
    .int(x)
    .byte(y)
    .int(z)
    .short(blockId)
    .byte(metadata & 0x0f)
    .build();
}

export function buildPlayerInfoPacket(
  smallId: number,
  playerIndex: number,
  entityId: number,
  privileges = 0,
): Buffer {
  return new BufferWriter()
    .byte(201)
    .byte(smallId)
    .short(playerIndex)
    .int(privileges)
    .int(entityId)
    .build();
}

export function buildAddPlayerPacket(player: SavedPlayer, entityId: number, playerIndex: number): Buffer {
  const rotationByte = (degrees: number): number => Math.floor((degrees * 256) / 360);
  return new BufferWriter()
    .byte(20)
    .int(entityId)
    .utf(player.name.slice(0, MAX_PLAYER_NAME_LENGTH))
    .int(Math.floor(player.x * 32))
    .int(Math.floor(player.y * 32))
    .int(Math.floor(player.z * 32))
    .byte(rotationByte(player.yaw))
    .byte(rotationByte(player.pitch))
    .byte(rotationByte(player.yaw))
    .short(0)
    .long(0n)
    .long(0n)
    .byte(playerIndex)
    .int(0)
    .int(0)
    .int(0)
    .byte(127)
    .build();
}

export function buildRemovePlayerPacket(entityId: number): Buffer {
  return new BufferWriter().byte(29).byte(1).int(entityId).build();
}

export function buildPlayerTeleportPacket(player: SavedPlayer, entityId: number): Buffer {
  const rotationByte = (degrees: number): number => Math.floor((degrees * 256) / 360);
  return new BufferWriter()
    .byte(34)
    .int(entityId)
    .int(Math.floor(player.x * 32))
    .int(Math.floor(player.y * 32))
    .int(Math.floor(player.z * 32))
    .byte(rotationByte(player.yaw))
    .byte(rotationByte(player.pitch))
    .build();
}

export function buildPlayerPositionPacket(player: SavedPlayer): Buffer {
  return new BufferWriter()
    .byte(13)
    .double(player.x)
    .double(player.y)
    .double(player.y + 1.62)
    .double(player.z)
    .float(player.yaw)
    .float(player.pitch)
    .byte(0)
    .build();
}

export function buildDroppedItemPackets(
  entityId: number,
  item: InventoryStack,
  position: { x: number; y: number; z: number },
): Buffer[] {
  const scaledPosition = [position.x, position.y, position.z].map((coordinate) => Math.floor(coordinate * 32));
  if (scaledPosition.some((coordinate) => coordinate < -32768 || coordinate > 32767)) return [];
  const spawn = new BufferWriter()
    .byte(23)
    .int(entityId)
    .byte(2)
    .int(scaledPosition[0])
    .int(scaledPosition[1])
    .int(scaledPosition[2])
    .byte(0)
    .byte(0)
    .int(-1)
    .build();
  const metadata = new BufferWriter()
    .byte(40)
    .int(entityId)
    .byte((5 << 5) | 10)
    .short(item.id)
    .byte(item.count)
    .short(item.damage)
    .short(-1)
    .byte(127)
    .build();
  return [spawn, metadata];
}

export function buildTakeItemEntityPacket(itemEntityId: number, playerEntityId: number): Buffer {
  return new BufferWriter().byte(22).int(itemEntityId).int(playerEntityId).build();
}

export function buildChatPacket(message: string): Buffer {
  return new BufferWriter().byte(3).short(0).short(0x10).utf(message).build();
}

export function buildDisconnectPacket(reason: number): Buffer {
  return new BufferWriter().byte(255).int(reason).build();
}

export function buildRespawnPacket(dimension: number, seed: bigint, entityId: number, gameMode = 0): Buffer {
  if (![-1, 0, 1].includes(dimension)) throw new RangeError(`Unsupported dimension: ${dimension}`);
  return new BufferWriter()
    .byte(9)
    .byte(dimension)
    .byte(gameMode)
    .short(WORLD_HEIGHT)
    .utf('flat')
    .long(seed)
    .byte(1)
    .bool(false)
    .int(entityId)
    .short(320)
    .byte(8)
    .build();
}

export function parseClientPacket(buffer: Buffer, joined: boolean): ClientPacket {
  const reader = new BufferReader(buffer);
  const id = reader.byte();
  const packet: ClientPacket = { id, bytesRead: 0 };

  if (!joined && id === 2) {
    packet.netcodeVersion = reader.short();
    packet.loginKey = reader.utf(32);
    reader.byte();
    reader.int();
    const playerCount = reader.byte();
    if (playerCount > 32) throw new Error('Pre-login player count exceeds supported limit');
    reader.bytes(playerCount * 8);
    reader.bytes(14);
    reader.int();
    reader.byte();
    reader.int();
    packet.bytesRead = reader.offset;
    return packet;
  }

  if (!joined && id === 1) {
    packet.clientVersion = reader.int();
    packet.username = reader.utf(MAX_PLAYER_NAME_LENGTH);
    reader.utf(MAX_PLAYER_NAME_LENGTH);
    reader.long();
    reader.int();
    reader.byte();
    reader.byte();
    reader.byte();
    reader.bytes(16);
    reader.bool();
    reader.int();
    reader.byte();
    reader.int();
    reader.byte();
    reader.int();
    reader.int();
    reader.bool();
    reader.bool();
    reader.int();
    reader.short();
    reader.byte();
    if (!packet.username.trim()) throw new Error('Player name must not be empty');
    packet.bytesRead = reader.offset;
    return packet;
  }

  switch (id) {
    case 0:
      packet.keepAliveId = reader.int();
      break;
    case 3: {
      reader.short();
      const packedCounts = reader.unsignedShort();
      const strings: string[] = [];
      const stringCount = (packedCounts >> 4) & 0x0f;
      const intCount = packedCounts & 0x0f;
      for (let i = 0; i < stringCount; i += 1) strings.push(reader.utf(258));
      for (let i = 0; i < intCount; i += 1) reader.int();
      packet.chat = strings[0];
      break;
    }
    case 10:
      reader.byte();
      break;
    case 11:
      packet.position = { x: reader.double(), y: reader.double(), yView: reader.double(), z: reader.double() };
      reader.byte();
      break;
    case 12:
      packet.rotation = { yaw: reader.float(), pitch: reader.float() };
      reader.byte();
      break;
    case 13:
      packet.position = { x: reader.double(), y: reader.double(), yView: reader.double(), z: reader.double() };
      packet.rotation = { yaw: reader.float(), pitch: reader.float() };
      reader.byte();
      break;
    case 14:
      packet.action = reader.byte();
      packet.blockX = reader.int();
      packet.blockY = reader.byte();
      packet.blockZ = reader.int();
      packet.face = reader.byte();
      break;
    case 15:
      packet.blockX = reader.int();
      packet.blockY = reader.byte();
      packet.blockZ = reader.int();
      packet.face = reader.byte();
      packet.item = readItem(reader);
      reader.bytes(3);
      break;
    case 16:
      packet.selectedSlot = reader.short();
      break;
    case 18:
      reader.bytes(5);
      break;
    case 19:
      reader.bytes(9);
      break;
    case 27:
      reader.bytes(10);
      break;
    case 101:
      reader.byte();
      break;
    case 106:
      reader.bytes(3);
      break;
    case 107:
      packet.creativeSlot = reader.short();
      packet.item = readItem(reader);
      break;
    case 205:
      reader.byte();
      break;
    case 250: {
      const channel = reader.utf(20);
      const length = reader.short();
      if (length < 0 || length > 32767) throw new Error(`Invalid custom payload length: ${length}`);
      packet.customPayload = { channel, data: Buffer.from(reader.bytes(length)) };
      break;
    }
    case 254:
      break;
    case 255:
      reader.int();
      packet.disconnected = true;
      break;
    default:
      packet.unsupported = true;
      packet.bytesRead = buffer.length;
      return packet;
  }
  packet.bytesRead = reader.offset;
  return packet;
}

function readItem(reader: BufferReader): ItemStackPacket | null {
  const id = reader.short();
  if (id === -1) return null;
  if (id < 0 || id >= 32000) throw new Error(`Invalid item ID ${id}`);
  const count = reader.byte();
  const damage = reader.short();
  const nbtLength = reader.short();
  if (nbtLength < -1) throw new Error('Invalid item NBT payload length');
  if (nbtLength > 0) reader.bytes(nbtLength);
  return { id, count, damage };
}

function writeItem(writer: BufferWriter, stack: InventoryStack | null): void {
  if (!stack || stack.count <= 0) {
    writer.short(-1);
    return;
  }
  writer.short(stack.id).byte(stack.count).short(stack.damage).short(-1);
}
