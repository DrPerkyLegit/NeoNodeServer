import type { Socket } from 'node:net';
import { Logger } from '../utils/Logger';
import { PacketRegistry, isIncompletePacketError } from './PacketRegistry';
import { FIRST_REMOTE_SMALL_ID, MAX_REMOTE_SMALL_ID } from './ProtocolConstants';
import type { ServerPacketHandler } from './ServerPacketHandler';
import type { GamePacket } from './packets/GamePacket';
import type { PluginManager } from '../plugin/PluginManager';

const MAX_PENDING_BYTES = 4 * 1024 * 1024 + 4;
const MAX_OUTBOUND_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_PACKET_BYTES = 4 * 1024 * 1024;

export class PacketConnection {
  private transportData = Buffer.alloc(0);
  private packetData = Buffer.alloc(0);
  private processing = Promise.resolve();
  private closed = false;

  constructor(
    public readonly socket: Socket,
    public readonly smallId: number,
    private readonly registry: PacketRegistry,
    private readonly packetHandler: ServerPacketHandler,
    private readonly onClosed: (connection: PacketConnection) => void,
    private readonly plugins?: PluginManager,
  ) {
    if (!Number.isInteger(smallId) || smallId < FIRST_REMOTE_SMALL_ID || smallId > MAX_REMOTE_SMALL_ID) {
      throw new RangeError(`Small ID must be an integer from ${FIRST_REMOTE_SMALL_ID} to ${MAX_REMOTE_SMALL_ID}: ${smallId}`);
    }

    socket.on('data', (data) => this.receive(typeof data === 'string' ? Buffer.from(data) : data));
    socket.on('error', (error) => {
      if ('code' in error && error.code === 'ECONNRESET') {
        this.finish();
        return;
      }
      this.fail(`Socket error: ${error.message}`);
    });
    socket.on('close', () => this.finish());
    socket.write(Buffer.from([smallId]));
  }

  get remoteAddress(): string {
    return `${this.socket.remoteAddress ?? 'unknown'}:${this.socket.remotePort ?? 0}`;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(packet: GamePacket): void {
    this.sendPackets([packet]);
  }

  sendPackets(packets: readonly GamePacket[]): void {
    if (this.closed || !this.socket.writable) throw new Error('Cannot send packets on a closed connection');
    const packetData = Buffer.concat(
      packets.flatMap((packet) => {
        const event = {
          packet,
          connection: this,
          direction: 'outbound',
          cancelled: false,
        };
        this.plugins?.emit('packet:outbound', event);
        this.plugins?.emit(`packet:outbound:${event.packet.getName()}`, event);
        return event.cancelled ? [] : [event.packet.encode()];
      }),
    );
    if (packetData.length === 0) return;
    if (packetData.length > MAX_PACKET_BYTES) {
      throw new RangeError(`Packet data exceeds ${MAX_PACKET_BYTES} bytes`);
    }
    const frameHeader = Buffer.alloc(4);
    frameHeader.writeUInt32BE(packetData.length);
    this.writeFrame(Buffer.concat([frameHeader, packetData]));
  }

  sendPacketData(packetData: Buffer): void {
    if (packetData.length > MAX_PACKET_BYTES) {
      throw new RangeError(`Packet data exceeds ${MAX_PACKET_BYTES} bytes`);
    }
    const frameHeader = Buffer.alloc(4);
    frameHeader.writeUInt32BE(packetData.length);
    this.sendEncodedFrame(Buffer.concat([frameHeader, packetData]));
  }

  sendEncodedFrame(frame: Buffer): void {
    this.sendEncodedFrames(frame);
  }

  sendEncodedFrames(frames: Buffer): void {
    if (this.closed || !this.socket.writable) throw new Error('Cannot send packets on a closed connection');
    frames = this.processOutboundFrames(frames);
    if (frames.length === 0) return;
    let offset = 0;
    while (offset < frames.length) {
      if (frames.length - offset < 5) throw new RangeError('Encoded packet batch contains an incomplete frame');
      const frameLength = frames.readUInt32BE(offset);
      if (frameLength < 1 || frameLength > MAX_PACKET_BYTES || offset + frameLength + 4 > frames.length) {
        throw new RangeError('Encoded packet batch contains an invalid frame length');
      }
      offset += frameLength + 4;
    }
    this.writeFrame(frames);
  }

  private writeFrame(data: Buffer): void {
    if (this.socket.writableLength + data.length > MAX_OUTBOUND_BUFFER_BYTES) {
      this.fail(`Outbound buffer exceeded ${MAX_OUTBOUND_BUFFER_BYTES} bytes`);
      throw new Error('Connection outbound buffer limit exceeded');
    }
    this.socket.write(data);
  }

  close(): void {
    if (!this.closed) this.socket.end();
  }

  private receive(data: Buffer): void {
    if (this.closed) return;
    this.transportData = Buffer.concat([this.transportData, data]);
    this.processing = this.processing.then(() => this.processPending()).catch((error: unknown) => {
      this.fail(`Packet processing failed: ${errorMessage(error)}`);
    });
  }

  private async processPending(): Promise<void> {
    while (!this.closed && this.transportData.length >= 4) {
      const frameLength = this.transportData.readUInt32BE(0);
      if (frameLength === 0 || frameLength > MAX_PACKET_BYTES) {
        throw new Error(`Invalid framed packet length ${frameLength}`);
      }
      if (this.transportData.length < frameLength + 4) break;

      this.packetData = Buffer.concat([
        this.packetData,
        this.transportData.subarray(4, frameLength + 4),
      ]);
      this.transportData = this.transportData.subarray(frameLength + 4);
      if (this.packetData.length > MAX_PACKET_BYTES) {
        throw new Error(`Buffered game packets exceed ${MAX_PACKET_BYTES} bytes`);
      }

      while (!this.closed && this.packetData.length > 0) {
        let decoded;
        try {
          decoded = this.registry.decode(this.packetData);
        } catch (error) {
          if (isIncompletePacketError(error)) break;
          throw error;
        }
        if (decoded.bytesRead <= 0) throw new Error('Packet decoder did not consume any input');

        this.packetData = this.packetData.subarray(decoded.bytesRead);
        const event = {
          packet: decoded.packet,
          connection: this,
          direction: 'inbound',
          cancelled: false,
        };
        this.plugins?.emit('packet:inbound', event);
        this.plugins?.emit(`packet:inbound:${event.packet.getName()}`, event);
        if (event.cancelled) continue;
        await event.packet.handle(this.packetHandler, this);
      }
    }

    if (this.transportData.length > MAX_PENDING_BYTES) {
      throw new Error(`Incomplete transport frame exceeds ${MAX_PENDING_BYTES} bytes`);
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    Logger.warn(`Closing ${this.remoteAddress}: ${reason}`);
    this.socket.destroy();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.transportData = Buffer.alloc(0);
    this.packetData = Buffer.alloc(0);
    try {
      this.plugins?.emit('connection:close', { connection: this });
    } catch (error) {
      Logger.error('Plugin failed during connection:close:', error);
    } finally {
      this.onClosed(this);
    }
  }

  private processOutboundFrames(frames: Buffer): Buffer {
    if (frames.length === 0) throw new RangeError('Encoded packet batch must not be empty');
    if (!this.plugins?.hasListenersWithPrefix('packet:outbound')) return frames;
    const output: Buffer[] = [];
    let offset = 0;
    while (offset < frames.length) {
      if (frames.length - offset < 5) throw new RangeError('Encoded packet batch contains an incomplete frame');
      const frameLength = frames.readUInt32BE(offset);
      if (frameLength < 1 || frameLength > MAX_PACKET_BYTES || offset + frameLength + 4 > frames.length) {
        throw new RangeError('Encoded packet batch contains an invalid frame length');
      }

      const packetData = frames.subarray(offset + 4, offset + 4 + frameLength);
      const transformed = this.processOutboundPackets(packetData);
      if (transformed.length > 0) {
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(transformed.length);
        output.push(header, transformed);
      }
      offset += frameLength + 4;
    }
    return Buffer.concat(output);
  }

  private processOutboundPackets(packetData: Buffer): Buffer {
    if (!this.plugins) return packetData;
    const output: Buffer[] = [];
    let offset = 0;
    while (offset < packetData.length) {
      const remaining = packetData.subarray(offset);
      const decoded = this.registry.decode(remaining);
      if (decoded.bytesRead <= 0) throw new Error('Outbound packet decoder did not consume any input');
      const originalName = decoded.packet.getName();
      const specificEvent = `packet:outbound:${originalName}`;
      const hasGenericListener = this.plugins.hasListeners('packet:outbound');
      const hasSpecificListener = this.plugins.hasListeners(specificEvent);
      if (!hasGenericListener && !hasSpecificListener) {
        output.push(remaining.subarray(0, decoded.bytesRead));
        offset += decoded.bytesRead;
        continue;
      }
      const event = {
        packet: decoded.packet,
        connection: this,
        direction: 'outbound',
        cancelled: false,
      };
      if (hasGenericListener) this.plugins.emit('packet:outbound', event);
      const eventName = `packet:outbound:${event.packet.getName()}`;
      if (eventName !== specificEvent || hasSpecificListener) {
        if (this.plugins.hasListeners(eventName)) this.plugins.emit(eventName, event);
      }
      if (!event.cancelled) output.push(event.packet.encode());
      offset += decoded.bytesRead;
    }
    return Buffer.concat(output);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
