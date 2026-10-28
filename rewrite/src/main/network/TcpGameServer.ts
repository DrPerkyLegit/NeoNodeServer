import { createServer, type AddressInfo, type Server } from 'node:net';
import { Logger } from '../utils/Logger';
import { PacketConnection } from './PacketConnection';
import { PacketRegistry } from './PacketRegistry';
import { FIRST_REMOTE_SMALL_ID, MAX_REMOTE_SMALL_ID } from './ProtocolConstants';
import { ServerPacketHandler } from './ServerPacketHandler';
import type { PluginManager } from '../plugin/PluginManager';

export class TcpGameServer {
  private readonly connections = new Set<PacketConnection>();
  private readonly connectionsBySmallId = new Map<number, PacketConnection>();
  private server: Server | undefined;

  constructor(
    private readonly registry: PacketRegistry,
    private readonly packetHandler: ServerPacketHandler,
    private readonly maxConnections = MAX_REMOTE_SMALL_ID - FIRST_REMOTE_SMALL_ID + 1,
    private readonly plugins?: PluginManager,
  ) {
    const maximumConnections = MAX_REMOTE_SMALL_ID - FIRST_REMOTE_SMALL_ID + 1;
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > maximumConnections) {
      throw new RangeError(`Maximum connections must be from 1 to ${maximumConnections}: ${maxConnections}`);
    }
  }

  async listen(host: string, port: number): Promise<AddressInfo> {
    if (this.server) throw new Error('Network server is already listening');
    const server = createServer((socket) => {
      const smallId = this.allocateSmallId();
      if (smallId === undefined) {
        Logger.warn(`Rejecting connection from ${socket.remoteAddress ?? 'unknown'}: server is full`);
        socket.destroy();
        return;
      }

      let connection: PacketConnection;
      connection = new PacketConnection(socket, smallId, this.registry, this.packetHandler, (closedConnection) => {
        this.connections.delete(closedConnection);
        this.connectionsBySmallId.delete(closedConnection.smallId);
        this.packetHandler.onConnectionClosed(closedConnection);
        Logger.info(`Disconnected ${closedConnection.remoteAddress} (small ID ${closedConnection.smallId})`);
      }, this.plugins);
      this.connections.add(connection);
      this.connectionsBySmallId.set(smallId, connection);
      try {
        this.plugins?.emit('connection:open', { connection });
      } catch (error) {
        Logger.error('Plugin failed during connection:open:', error);
        connection.close();
        return;
      }
      Logger.info(`Accepted connection from ${connection.remoteAddress} (small ID ${smallId})`);
    });
    this.server = server;
    server.on('error', (error) => Logger.error('TCP server error:', error));

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    } catch (error) {
      this.server = undefined;
      throw new Error(`Unable to listen on ${host}:${port}: ${errorMessage(error)}`, { cause: error });
    }

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP listener did not provide an IP address');
    Logger.success(`Listening on ${address.address}:${address.port}`);
    if (this.registry.size === 0) {
      Logger.warn('No packet codecs are registered; incoming game packets will be rejected.');
    }
    return address;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;

    for (const connection of this.connections) connection.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  getConnectionBySmallId(smallId: number): PacketConnection | undefined {
    return this.connectionsBySmallId.get(smallId);
  }

  private allocateSmallId(): number | undefined {
    for (let smallId = FIRST_REMOTE_SMALL_ID; smallId < FIRST_REMOTE_SMALL_ID + this.maxConnections; smallId += 1) {
      if (!this.connectionsBySmallId.has(smallId)) return smallId;
    }
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
