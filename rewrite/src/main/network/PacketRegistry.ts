import { IncompletePacketError } from './errors/IncompletePacketError';
import { BufferReader } from './buffers/BufferReader';
import type { GamePacket } from './packets/GamePacket';
import { UnknownPacket } from './packets/UnknownPacket';

export interface DecodedPacket {
  readonly packet: GamePacket;
  readonly bytesRead: number;
}

export class PacketRegistry {
  private readonly packetFactories = new Map<number, () => GamePacket>();
  private readonly packetNames = new Map<string, number>();
  private readonly namesById = new Map<number, string>();

  register(packetName: string, factory: () => GamePacket): this {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(packetName)) {
      throw new Error(`Invalid packet name "${packetName}"`);
    }
    if (this.packetNames.has(packetName)) throw new Error(`Packet name "${packetName}" is already registered`);
    const packet = factory();
    const packetId = packet.getId();
    if (!Number.isInteger(packetId) || packetId < 0 || packetId > 0xff) {
      throw new RangeError(`Packet ID must be an integer from 0 to 255: ${packetId}`);
    }
    if (this.packetFactories.has(packetId)) throw new Error(`Packet ID ${packetId} is already registered`);
    if (packet.getName() !== packetName) {
      throw new Error(`Packet factory name mismatch: registered "${packetName}", created "${packet.getName()}"`);
    }

    this.packetFactories.set(packetId, factory);
    this.packetNames.set(packetName, packetId);
    this.namesById.set(packetId, packetName);
    return this;
  }

  decode(buffer: Buffer): DecodedPacket {
    const reader = new BufferReader(buffer);
    const packetId = reader.readByte();
    const factory = this.packetFactories.get(packetId);
    const packet = factory ? factory() : new UnknownPacket(packetId);
    if (packet.getId() !== packetId) {
      throw new Error(`Packet factory for ID ${packetId} created packet ID ${packet.getId()}`);
    }
    const registeredName = this.namesById.get(packetId);
    if (registeredName !== undefined && packet.getName() !== registeredName) {
      throw new Error(`Packet factory for ID ${packetId} created unexpected packet "${packet.getName()}"`);
    }
    try {
      packet.read(reader);
    } catch (error) {
      if (isIncompletePacketError(error)) throw error;
      const safeHeader = buffer.subarray(0, Math.min(buffer.length, 5)).toString('hex');
      throw new Error(
        `Unable to decode packet "${packet.getName()}" (ID ${packetId}) at payload offset ${reader.offset}; ` +
        `received ${buffer.length} byte(s), header=${safeHeader}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    if (reader.offset > buffer.length) throw new Error(`Packet ${packet.getName()} read beyond its input`);
    return { packet, bytesRead: reader.offset };
  }

  get size(): number {
    return this.packetFactories.size;
  }
}

export function isIncompletePacketError(error: unknown): error is IncompletePacketError {
  return error instanceof IncompletePacketError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
