import { EntityRegistry } from './EntityRegistry';
import { Player } from './Player';
import type { GamePacket } from '../network/packets/GamePacket';

export interface PlayerConnection {
  readonly smallId: number;
  readonly remoteAddress: string;
  send(packet: GamePacket): void;
}

export class PlayerManager {
  private readonly playersByConnection = new Map<PlayerConnection, Player>();
  private readonly connectionsByName = new Map<string, PlayerConnection>();

  constructor(
    private readonly entities: EntityRegistry,
    private readonly maxPlayers: number,
  ) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
      throw new RangeError(`Maximum players must be a positive integer: ${maxPlayers}`);
    }
  }

  join(connection: PlayerConnection, username: string): Player {
    const key = username.toLowerCase();
    if (this.playersByConnection.size >= this.maxPlayers) throw new Error('Server is full');
    if (this.playersByConnection.has(connection)) throw new Error('Connection already has a player');
    if (this.connectionsByName.has(key)) throw new Error(`Username "${username}" is already online`);

    const player = this.entities.add(new Player(
      this.entities.allocateId(),
      username,
      connection.smallId,
      connection.remoteAddress,
    ));
    this.playersByConnection.set(connection, player);
    this.connectionsByName.set(key, connection);
    return player;
  }

  leave(connection: PlayerConnection): Player | undefined {
    const player = this.playersByConnection.get(connection);
    if (!player) return undefined;
    this.playersByConnection.delete(connection);
    this.connectionsByName.delete(player.username.toLowerCase());
    this.entities.remove(player.id);
    return player;
  }

  getByConnection(connection: PlayerConnection): Player | undefined {
    return this.playersByConnection.get(connection);
  }

  getByName(username: string): Player | undefined {
    const connection = this.connectionsByName.get(username.toLowerCase());
    return connection ? this.playersByConnection.get(connection) : undefined;
  }

  values(): ReadonlyArray<Player> {
    return [...this.playersByConnection.values()];
  }

  entries(): ReadonlyArray<readonly [PlayerConnection, Player]> {
    return [...this.playersByConnection.entries()];
  }

  forEachConnection(callback: (connection: PlayerConnection, player: Player) => void): void {
    for (const [connection, player] of this.playersByConnection) callback(connection, player);
  }

  connectionForPlayer(player: Player): PlayerConnection | undefined {
    for (const [connection, connectedPlayer] of this.playersByConnection) {
      if (connectedPlayer === player) return connection;
    }
    return undefined;
  }
}
