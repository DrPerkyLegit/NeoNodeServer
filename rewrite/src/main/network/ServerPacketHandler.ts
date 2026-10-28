
import { Logger } from '../utils/Logger';
import type { PacketConnection } from './PacketConnection';
import type { GamePacket } from './packets/GamePacket';

export class ServerPacketHandler {
  private readonly packetHandlers = new Map<
    string,
    (packet: GamePacket, connection: PacketConnection) => void | Promise<void>
  >();

  registerPacketHandler(
    packetName: string,
    handler: (packet: GamePacket, connection: PacketConnection) => void | Promise<void>,
  ): this {
    if (this.packetHandlers.has(packetName)) {
      throw new Error(`A handler is already registered for packet "${packetName}"`);
    }
    this.packetHandlers.set(packetName, handler);
    return this;
  }

  async handlePacketName(packet: GamePacket, connection: PacketConnection): Promise<void> {
    const handler = this.packetHandlers.get(packet.getName());
    if (handler) {
      await handler(packet, connection);
      return;
    }

    await this.onUnhandledPacket(packet, connection);
  }

  onConnectionClosed(_connection: PacketConnection): void {}

  protected onUnhandledPacket(packet: GamePacket, connection: PacketConnection): void {
    Logger.warn(`No handler registered for packet "${packet.getName()}" from ${connection.remoteAddress}`);
  }
}