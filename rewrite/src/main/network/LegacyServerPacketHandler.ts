import { EntityRegistry } from '../entities/EntityRegistry';
import { PlayerManager } from '../entities/PlayerManager';
import type { WorldServer } from '../server/WorldServer';
import { Logger } from '../utils/Logger';
import { LEGACY_NETCODE_VERSION, LEGACY_PROTOCOL_VERSION } from './ProtocolConstants';
import { PacketConnection } from './PacketConnection';
import { ServerPacketHandler } from './ServerPacketHandler';
import { KeepAlivePacket } from './packets/KeepAlivePacket';
import { LoginPacket } from './packets/LoginPacket';
import { PreLoginPacket } from './packets/PreLoginPacket';
import { PlayerAbilitiesPacket } from './packets/PlayerAbilitiesPacket';
import { SetCarriedItemPacket } from './packets/SetCarriedItemPacket';
import { SetSpawnPositionPacket } from './packets/SetSpawnPositionPacket';
import { ChatPacket } from './packets/ChatPacket';
import { MovePlayerPacket } from './packets/MovePlayerPacket';
import { PlayerAction, PlayerActionPacket } from './packets/PlayerActionPacket';
import { ContainerSetSlotPacket } from './packets/ContainerSetSlotPacket';
import { TileUpdatePacket } from './packets/TileUpdatePacket';
import { UseItemPacket } from './packets/UseItemPacket';
import { SetHealthPacket } from './packets/SetHealthPacket';
import { SetTimePacket } from './packets/SetTimePacket';
import { ContainerSetContentPacket } from './packets/ContainerSetContentPacket';
import { ChunkVisibilityPacket } from './packets/ChunkVisibilityPacket';
import { ChunkDataPacket } from './packets/ChunkDataPacket';
import type { GamePacket } from './packets/GamePacket';
import { AnimatePacket } from './packets/AnimatePacket';
import { PlayerCommandPacket } from './packets/PlayerCommandPacket';
import { PlayerInfoPacket } from './packets/PlayerInfoPacket';
import { AddPlayerPacket } from './packets/AddPlayerPacket';
import { TeleportEntityPacket } from './packets/TeleportEntityPacket';
import { RemoveEntitiesPacket } from './packets/RemoveEntitiesPacket';
import { SpawnItemEntityPacket } from './packets/SpawnItemEntityPacket';
import { EntityItemMetadataPacket } from './packets/EntityItemMetadataPacket';
import { TakeItemEntityPacket } from './packets/TakeItemEntityPacket';
import { ItemEntity } from '../entities/ItemEntity';
import { ItemStack } from '../items/ItemStack';
import { ContainerClosePacket } from './packets/ContainerClosePacket';
import { ContainerClickPacket } from './packets/ContainerClickPacket';
import { ContainerAckPacket } from './packets/ContainerAckPacket';
import { DisconnectPacket } from './packets/DisconnectPacket';
import { ServerSettingsChangedPacket } from './packets/ServerSettingsChangedPacket';
import type { PluginManager } from '../plugin/PluginManager';

const EMPTY_SAVE_NAME = Buffer.alloc(14);
const INITIAL_CHUNK_RADIUS = 4;

export class LegacyServerPacketHandler extends ServerPacketHandler {
  readonly entities: EntityRegistry;
  readonly players: PlayerManager;
  private readonly preLoginNames = new Map<PacketConnection, string>();
  private readonly pendingMovementPackets = new Map<PacketConnection, TeleportEntityPacket>();

  constructor(
    private readonly worldServer: WorldServer,
    private readonly plugins?: PluginManager,
  ) {
    super();
    this.entities = worldServer.entities;
    this.players = new PlayerManager(this.entities, worldServer.properties.maxPlayers);
    this.registerPacketHandler('KeepAlive', (packet, connection) => {
      if (!(packet instanceof KeepAlivePacket)) throw new Error('KeepAlive codec returned an incompatible packet');
      connection.send(new KeepAlivePacket(packet.id));
    });
    this.registerPacketHandler('PreLogin', (packet, connection) => this.handlePreLogin(packet, connection));
    this.registerPacketHandler('Login', (packet, connection) => this.handleLogin(packet, connection));
    this.registerPacketHandler('SetCarriedItem', (packet, connection) => this.handleSetCarriedItem(packet, connection));
    this.registerPacketHandler('Chat', (packet, connection) => this.handleChat(packet, connection));
    this.registerPacketHandler('MovePlayerGround', (packet, connection) => this.handleMovement(packet, connection));
    this.registerPacketHandler('MovePlayerPosition', (packet, connection) => this.handleMovement(packet, connection));
    this.registerPacketHandler('MovePlayerRotation', (packet, connection) => this.handleMovement(packet, connection));
    this.registerPacketHandler('MovePlayerPositionRotation', (packet, connection) => this.handleMovement(packet, connection));
    this.registerPacketHandler('PlayerAction', (packet, connection) => this.handlePlayerAction(packet, connection));
    this.registerPacketHandler('UseItem', (packet, connection) => this.handleUseItem(packet, connection));
    this.registerPacketHandler('Animate', (packet, connection) => this.handleAnimate(packet, connection));
    this.registerPacketHandler('PlayerCommand', (packet, connection) => this.handlePlayerCommand(packet, connection));
    this.registerPacketHandler('ContainerClose', (packet, connection) => this.handleContainerClose(packet, connection));
    this.registerPacketHandler('ContainerClick', (packet, connection) => this.handleContainerClick(packet, connection));
    this.registerPacketHandler('ContainerAck', (packet, connection) => this.handleContainerAck(packet, connection));
    this.registerPacketHandler('Disconnect', (packet, connection) => this.handleDisconnect(packet, connection));
  }

  override onConnectionClosed(connection: PacketConnection): void {
    this.preLoginNames.delete(connection);
    this.pendingMovementPackets.delete(connection);
    const player = this.players.getByConnection(connection);
    if (player) {
      this.plugins?.emit('player:quit', { player, connection });
      this.broadcastToOthers(connection, new RemoveEntitiesPacket([player.id]));
      this.broadcastToOthers(connection, ChatPacket.message(`${player.username} left the game`));
      this.players.leave(connection);
      for (const world of this.worldServer.worlds.values()) world.removeEntity(player.id);
      Logger.info(`Player "${player.username}" left the server`);
    }
  }

  protected override onUnhandledPacket(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    Logger.warn(`Ignoring unsupported packet "${packet.getName()}" from ${connection.remoteAddress}`);
  }

  private handlePreLogin(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof PreLoginPacket)) throw new Error('PreLogin codec returned an incompatible packet');
    if (packet.netcodeVersion !== LEGACY_NETCODE_VERSION) {
      throw new Error(
        `Unsupported netcode version ${packet.netcodeVersion}; expected ${LEGACY_NETCODE_VERSION}`,
      );
    }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(packet.loginKey)) throw new Error('Invalid username in pre-login packet');
    if (this.players.getByConnection(connection)) throw new Error('Pre-login packet received after login');

    const event = this.plugins?.emit('player:prelogin', {
      username: packet.loginKey,
      connection,
      cancelled: false,
    });
    if (event?.cancelled) {
      connection.close();
      return;
    }
    this.preLoginNames.set(connection, packet.loginKey);
    connection.send(PreLoginPacket.response({
      netcodeVersion: LEGACY_NETCODE_VERSION,
      loginKey: '-',
      friendsOnlyBits: 0,
      ugcPlayersVersion: 0,
      uniqueSaveName: EMPTY_SAVE_NAME,
      serverSettings: 0,
      hostIndex: 0,
      texturePackId: 0,
    }));
    Logger.info(`Pre-login accepted for "${packet.loginKey}" from ${connection.remoteAddress}`);
  }

  private handleLogin(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof LoginPacket)) throw new Error('Login codec returned an incompatible packet');
    const expectedName = this.preLoginNames.get(connection);
    if (!expectedName) throw new Error('Login received before successful pre-login');
    if (packet.clientVersion !== LEGACY_PROTOCOL_VERSION) {
      throw new Error(`Unsupported protocol version ${packet.clientVersion}; expected ${LEGACY_PROTOCOL_VERSION}`);
    }
    if (packet.username.toLowerCase() !== expectedName.toLowerCase()) {
      throw new Error('Login username does not match pre-login username');
    }

    const loginEvent = this.plugins?.emit('player:login', {
      username: expectedName,
      connection,
      cancelled: false,
    });
    if (loginEvent?.cancelled) {
      connection.close();
      return;
    }
    const username = loginEvent?.username ?? expectedName;
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      throw new Error('Plugin supplied an invalid login username');
    }
    const player = this.players.join(connection, username);
    player.gameMode = this.worldServer.properties.gameMode;
    const world = this.worldServer.worlds.get(this.worldServer.properties.worldName);
    if (!world) throw new Error(`Player world "${this.worldServer.properties.worldName}" is unavailable`);
    world.addEntity(player);
    this.preLoginNames.delete(connection);
    player.teleport({ x: 0.5, y: 4, z: 0.5 });
    player.onGround = true;

    const response = new LoginPacket();
    response.clientVersion = player.id;
    response.username = '';
    response.levelType = this.worldServer.properties.worldType;
    response.seed = this.worldServer.properties.seed;
    response.gameType = player.gameMode === 'creative' ? 1 : 0;
    response.dimension = 0;
    response.mapHeight = 256;
    response.maxPlayers = this.worldServer.properties.maxPlayers;
    response.difficulty = 1;
    response.playerIndex = player.playerIndex;
    response.uiGamePrivileges = playerPrivileges(player.gameMode);
    const abilities = new PlayerAbilitiesPacket({
      invulnerable: player.gameMode === 'creative',
      flying: false,
      canFly: player.gameMode === 'creative',
      instantBuild: player.gameMode === 'creative',
      noPhysics: false,
    });

    const menuItems = this.inventoryMenuItems(player);
    const initialPackets: GamePacket[] = [
      response,
      new ServerSettingsChangedPacket(
        ServerSettingsChangedPacket.HOST_OPTIONS,
        this.worldServer.properties.gamertags ? 1 : 0,
      ),
      new SetSpawnPositionPacket(0, 4, 0),
      abilities,
      new SetHealthPacket(player.health, 20, 5),
      new SetCarriedItemPacket(player.selectedSlot),
      new ContainerSetContentPacket(0, menuItems),
      new SetTimePacket(0n, 6000n),
    ];
    initialPackets.push(new PlayerInfoPacket(
      player.smallId,
      player.playerIndex,
      response.uiGamePrivileges,
      player.id,
    ));
    for (const existingPlayer of this.players.values()) {
      if (existingPlayer === player) continue;
      initialPackets.push(this.playerInfoPacket(existingPlayer));
      initialPackets.push(this.addPlayerPacket(existingPlayer));
    }
    const position = new MovePlayerPacket('positionRotation');
    position.x = player.x;
    position.y = player.y;
    position.stance = player.y + 1.62;
    position.z = player.z;
    position.yaw = player.yaw;
    position.pitch = player.pitch;
    position.onGround = player.onGround;
    initialPackets.push(position);
    connection.sendPackets(initialPackets);

    for (let chunkZ = -INITIAL_CHUNK_RADIUS; chunkZ <= INITIAL_CHUNK_RADIUS; chunkZ += 1) {
      for (let chunkX = -INITIAL_CHUNK_RADIUS; chunkX <= INITIAL_CHUNK_RADIUS; chunkX += 1) {
        const chunk = world.getChunk(chunkX, chunkZ);
        connection.sendPackets([
          new ChunkVisibilityPacket(chunkX, chunkZ),
          new ChunkDataPacket(chunk),
        ]);
      }
    }
    this.broadcastToOthers(connection, this.playerInfoPacket(player));
    this.broadcastToOthers(connection, this.addPlayerPacket(player));
    this.broadcast(ChatPacket.message(`${player.username} joined the game`));
    this.plugins?.emit('player:join', { player, connection });
    this.plugins?.emit('player:login:complete', { player, connection });
    Logger.info(`Player "${player.username}" logged in with entity ID ${player.id}`);
  }

  private handleSetCarriedItem(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof SetCarriedItemPacket)) {
      throw new Error('SetCarriedItem codec returned an incompatible packet');
    }
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('SetCarriedItem received before login');
    if (!Number.isInteger(packet.slot) || packet.slot < 0 || packet.slot > 8) {
      throw new Error(`Invalid selected hotbar slot ${packet.slot}`);
    }
    player.selectedSlot = packet.slot;
    this.plugins?.emit('player:select-slot', { player, slot: packet.slot, packet, connection });
  }

  private handleChat(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof ChatPacket)) throw new Error('Chat codec returned an incompatible packet');
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('Chat received before login');
    let message = packet.strings[0]?.trim();
    if (!message) return;
    if (message.length > 256) throw new Error('Chat message exceeds 256 characters');
    const now = Date.now();
    if (now - player.lastChatAt < 250) throw new Error('Chat messages are being sent too quickly');
    player.lastChatAt = now;
    const chatEvent = this.plugins?.emit('player:chat', { player, message, packet, connection, cancelled: false });
    if (chatEvent?.cancelled) return;
    const editedMessage = chatEvent?.message ?? message;
    if (typeof editedMessage !== 'string') throw new Error('Plugin supplied an invalid chat message');
    message = editedMessage.trim();
    if (!message) return;
    if (message.length > 256) throw new Error('Plugin supplied a chat message exceeding 256 characters');
    if (message.startsWith('/')) {
      Logger.info(`Command from "${player.username}": ${message}`);
      const commandEvent = this.plugins?.emit('player:command', {
        player,
        command: message.slice(1),
        connection,
        cancelled: false,
        handled: false,
      });
      if (commandEvent?.cancelled || commandEvent?.handled) return;
      const command = commandEvent?.command ?? message.slice(1);
      if (typeof command !== 'string') throw new Error('Plugin supplied an invalid command');
      if (command !== message.slice(1)) {
        this.handleCommand(command, connection);
        return;
      }
      this.handleCommand(message.slice(1), connection);
      return;
    }

    const outgoing = ChatPacket.message(`${player.username}: ${message}`);
    this.broadcast(outgoing);
    Logger.info(`<${player.username}> ${message}`);
  }

  private handleCommand(input: string, connection: PacketConnection): void {
    const [command] = input.trim().split(/\s+/, 1);
    if (command?.toLowerCase() !== 'tps') {
      connection.send(ChatPacket.message(`Unknown command: /${command ?? ''}`));
      return;
    }
    connection.send(ChatPacket.message(`TPS: ${this.worldServer.tps.toFixed(2)}`));
  }

  private handleMovement(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof MovePlayerPacket)) throw new Error('Movement codec returned an incompatible packet');
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('Movement received before login');

    const hasPosition = packet.variant === 'position' || packet.variant === 'positionRotation';
    const hasRotation = packet.variant === 'rotation' || packet.variant === 'positionRotation';
    const x = hasPosition ? packet.x : player.x;
    const y = hasPosition ? packet.y : player.y;
    const z = hasPosition ? packet.z : player.z;
    const yaw = hasRotation ? packet.yaw : player.yaw;
    const pitch = hasRotation ? packet.pitch : player.pitch;
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) throw new Error('Movement contains non-finite coordinates');
    if (Math.abs(x) > 30_000_000 || Math.abs(z) > 30_000_000 || y < -64 || y > 512) {
      throw new Error('Movement position is outside permitted world bounds');
    }
    if (hasPosition && Math.hypot(x - player.x, y - player.y, z - player.z) > 100) {
      throw new Error('Movement exceeds maximum per-packet distance');
    }
    if (hasPosition && (packet.stance < y || packet.stance - y > 2.5)) {
      throw new Error('Movement stance is outside the permitted range');
    }
    const movementEvent = this.plugins?.emit('player:move', {
      player,
      packet,
      connection,
      x,
      y,
      z,
      yaw,
      pitch,
      onGround: packet.onGround,
      isFlying: packet.isFlying,
      cancelled: false,
    });
    if (movementEvent?.cancelled) return;
    const nextX = finiteNumber(movementEvent?.x ?? x, 'x');
    const nextY = finiteNumber(movementEvent?.y ?? y, 'y');
    const nextZ = finiteNumber(movementEvent?.z ?? z, 'z');
    const nextYaw = finiteNumber(movementEvent?.yaw ?? yaw, 'yaw');
    const nextPitch = finiteNumber(movementEvent?.pitch ?? pitch, 'pitch');
    if (Math.abs(nextX) > 30_000_000 || Math.abs(nextZ) > 30_000_000 || nextY < -64 || nextY > 512) {
      throw new Error('Plugin supplied movement outside permitted world bounds');
    }
    if (hasPosition && Math.hypot(nextX - player.x, nextY - player.y, nextZ - player.z) > 100) {
      throw new Error('Plugin supplied movement exceeding maximum per-packet distance');
    }
    player.teleport({ x: nextX, y: nextY, z: nextZ }, nextYaw, nextPitch);
    player.onGround = (movementEvent?.onGround ?? packet.onGround) === true;
    player.isFlying = player.gameMode === 'creative' && (movementEvent?.isFlying ?? packet.isFlying) === true;
    this.plugins?.emit('player:move:complete', { player, packet, connection });
    const movement = new TeleportEntityPacket(
      player.id,
      player.x,
      player.y,
      player.z,
      player.yaw,
      player.pitch,
    );
    this.pendingMovementPackets.set(connection, movement);
    this.collectNearbyItems(player);
  }

  flushMovementUpdates(): void {
    if (this.pendingMovementPackets.size === 0) return;
    const updates = [...this.pendingMovementPackets.entries()];
    this.pendingMovementPackets.clear();

    this.players.forEachConnection((recipient) => {
      if (
        !(recipient instanceof PacketConnection) ||
        recipient.isClosed ||
        !recipient.socket.writable
      ) {
        return;
      }
      const packets = updates
        .filter(([source]) => source !== recipient)
        .map(([, packet]) => packet);
      if (packets.length > 0) recipient.sendPackets(packets);
    });
  }

  private handleAnimate(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof AnimatePacket)) throw new Error('Animate codec returned an incompatible packet');
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('Animate received before login');
    packet.entityId = player.id;
    const event = this.plugins?.emit('player:animate', { player, packet, connection, cancelled: false });
    if (event?.cancelled) return;
    this.broadcastToOthers(connection, packet);
  }

  private handlePlayerCommand(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof PlayerCommandPacket)) {
      throw new Error('PlayerCommand codec returned an incompatible packet');
    }
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('PlayerCommand received before login');
    packet.entityId = player.id;
    const event = this.plugins?.emit('player:action', { player, packet, connection, cancelled: false });
    if (event?.cancelled) return;
    this.broadcastToOthers(connection, packet);
  }

  private handleContainerClose(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof ContainerClosePacket)) {
      throw new Error('ContainerClose codec returned an incompatible packet');
    }
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('ContainerClose received before login');
    this.plugins?.emit('player:container-close', { player, packet, connection });
  }

  private handleContainerClick(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof ContainerClickPacket)) {
      throw new Error('ContainerClick codec returned an incompatible packet');
    }
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('ContainerClick received before login');
    const clickEvent = this.plugins?.emit('player:inventory-click', {
      player,
      packet,
      slot: packet.slot,
      button: packet.button,
      connection,
      cancelled: false,
    });
    if (clickEvent?.cancelled) {
      this.syncContainer(connection, player, packet.containerId, packet.transactionId, false);
      return;
    }

    if (packet.containerId !== 0 || packet.clickType !== 0 || (packet.button !== 0 && packet.button !== 1)) {
      this.syncContainer(connection, player, packet.containerId, packet.transactionId, false);
      return;
    }

    if (packet.slot === -999) {
      this.dropCarriedItem(player, packet.button === 0);
    } else {
      const inventorySlot = containerSlotToInventorySlot(packet.slot);
      if (inventorySlot === undefined) {
        this.syncContainer(connection, player, packet.containerId, packet.transactionId, false);
        return;
      }
      this.clickInventorySlot(player, inventorySlot, packet.button);
    }
    this.syncContainer(connection, player, packet.containerId, packet.transactionId, true);
    this.plugins?.emit('player:inventory-click:complete', { player, packet, connection });
  }

  private handleContainerAck(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof ContainerAckPacket)) {
      throw new Error('ContainerAck codec returned an incompatible packet');
    }
    if (!this.players.getByConnection(connection)) throw new Error('ContainerAck received before login');
  }

  private handleDisconnect(packet: GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof DisconnectPacket)) {
      throw new Error('Disconnect codec returned an incompatible packet');
    }
    Logger.info(`Client ${connection.remoteAddress} disconnected (reason ${packet.reason})`);
    connection.close();
  }

  private handlePlayerAction(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof PlayerActionPacket)) {
      throw new Error('PlayerAction codec returned an incompatible packet');
    }
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('PlayerAction received before login');
    if (
      packet.action === PlayerAction.StartDestroyBlock ||
      packet.action === PlayerAction.AbortDestroyBlock
    ) return;
    if (packet.action !== PlayerAction.StopDestroyBlock) {
      Logger.warn(`Ignoring unsupported player action ${packet.action} from "${player.username}"`);
      return;
    }
    if (packet.face < 0 || packet.face > 5) throw new Error(`Invalid block face ${packet.face}`);
    if (!Number.isInteger(packet.y) || packet.y < 0 || packet.y > 255) {
      throw new Error(`Invalid block Y coordinate ${packet.y}`);
    }
    if (Math.hypot(player.x - (packet.x + 0.5), player.y - (packet.y + 0.5), player.z - (packet.z + 0.5)) > 6) {
      throw new Error('Block break is outside interaction range');
    }

    const world = this.worldServer.worlds.get(this.worldServer.properties.worldName);
    if (!world) throw new Error(`Player world "${this.worldServer.properties.worldName}" is unavailable`);
    const blockBefore = world.getBlock(packet.x, packet.y, packet.z);
    if (blockBefore === 0) return;
    const breakEvent = this.plugins?.emit('block:break', {
      player,
      world,
      x: packet.x,
      y: packet.y,
      z: packet.z,
      blockId: blockBefore,
      packet,
      connection,
      cancelled: false,
    });
    if (breakEvent?.cancelled) return;
    const blockId = this.worldServer.interactions.breakBlock(
      world,
      player,
      packet.x,
      packet.y,
      packet.z,
      (drop) => this.broadcastItemDrop(drop),
    );
    if (blockId === 0) {
      this.broadcastBlockUpdate(packet.x, packet.y, packet.z, blockBefore);
      return;
    }
    this.broadcastBlockUpdate(packet.x, packet.y, packet.z, 0);
    this.plugins?.emit('block:break:complete', { player, world, x: packet.x, y: packet.y, z: packet.z, blockId });
  }

  private handleUseItem(packet: import('./packets/GamePacket').GamePacket, connection: PacketConnection): void {
    if (!(packet instanceof UseItemPacket)) throw new Error('UseItem codec returned an incompatible packet');
    const player = this.players.getByConnection(connection);
    if (!player) throw new Error('UseItem received before login');
    if (packet.face === 0xff) return;
    if (packet.face < 0 || packet.face > 5) throw new Error(`Invalid block face ${packet.face}`);
    if (packet.y < 0 || packet.y > 255) throw new Error(`Invalid block Y coordinate ${packet.y}`);
    if (Math.hypot(player.x - (packet.x + 0.5), player.y - (packet.y + 0.5), player.z - (packet.z + 0.5)) > 6) {
      throw new Error('Block placement is outside interaction range');
    }

    const world = this.worldServer.worlds.get(this.worldServer.properties.worldName);
    if (!world) throw new Error(`Player world "${this.worldServer.properties.worldName}" is unavailable`);
    const itemStack = player.inventory.get(player.selectedSlot);
    if (!itemStack || !this.worldServer.blocks.get(itemStack.item.id)) return;
    if (packet.item && packet.item.itemId !== itemStack.item.id) return;

    const target = faceOffset(packet.x, packet.y, packet.z, packet.face);
    if (target.y < 0 || target.y > 255) return;
    if (world.getBlock(target.x, target.y, target.z) !== 0) return;
    const placeEvent = this.plugins?.emit('block:place', {
      player,
      world,
      x: target.x,
      y: target.y,
      z: target.z,
      blockId: itemStack.item.id,
      packet,
      connection,
      cancelled: false,
    });
    if (placeEvent?.cancelled) return;
    const inventoryBefore = player.inventory.snapshot();
    this.worldServer.interactions.placeBlock(world, player, target.x, target.y, target.z, itemStack.item.id);
    this.broadcastBlockUpdate(target.x, target.y, target.z, itemStack.item.id);
    this.syncInventory(player, inventoryBefore);
    this.plugins?.emit('block:place:complete', {
      player, world, x: target.x, y: target.y, z: target.z, blockId: itemStack.item.id,
    });
  }

  private syncInventory(
    player: import('../entities/Player').Player,
    previous: ReturnType<import('../items/Inventory').Inventory['snapshot']>,
  ): void {
    const connection = this.players.connectionForPlayer(player);
    if (!connection) throw new Error(`Player "${player.username}" has no active connection`);
    const current = player.inventory.snapshot();
    for (let slot = 0; slot < current.length; slot += 1) {
      if (stacksEqual(previous[slot], current[slot])) continue;
      const menuSlot = slot < 9 ? slot + 36 : slot;
      connection.send(new ContainerSetSlotPacket(0, menuSlot, current[slot]));
    }
  }

  private inventoryMenuItems(player: import('../entities/Player').Player) {
    const inventory = player.inventory.snapshot();
    return [
      ...Array.from({ length: 9 }, () => undefined),
      ...inventory.slice(9),
      ...inventory.slice(0, 9),
    ];
  }

  private syncContainer(
    connection: PacketConnection,
    player: import('../entities/Player').Player,
    containerId: number,
    transactionId: number,
    accepted: boolean,
  ): void {
    connection.send(new ContainerAckPacket(containerId, transactionId, accepted));
    connection.send(new ContainerSetContentPacket(0, this.inventoryMenuItems(player)));
    connection.send(new ContainerSetSlotPacket(-1, -1, player.carriedItem));
  }

  private clickInventorySlot(
    player: import('../entities/Player').Player,
    inventorySlot: number,
    button: number,
  ): void {
    const slotItem = player.inventory.get(inventorySlot);
    const carriedItem = player.carriedItem?.clone();
    if (!carriedItem) {
      if (!slotItem) return;
      const takenCount = button === 0 ? slotItem.count : Math.ceil(slotItem.count / 2);
      player.carriedItem = player.inventory.take(inventorySlot, takenCount);
      return;
    }
    if (!slotItem) {
      if (button === 0) {
        player.inventory.set(inventorySlot, carriedItem);
        player.carriedItem = undefined;
      } else {
        player.inventory.set(inventorySlot, new ItemStack(carriedItem.item, 1, carriedItem.damage));
        player.carriedItem = carriedItem.count === 1
          ? undefined
          : new ItemStack(carriedItem.item, carriedItem.count - 1, carriedItem.damage);
      }
      return;
    }
    if (!slotItem.canMerge(carriedItem)) {
      if (button === 0) {
        player.inventory.set(inventorySlot, carriedItem);
        player.carriedItem = slotItem;
      }
      return;
    }

    const amountToMove = button === 0
      ? Math.min(carriedItem.count, slotItem.item.maxStackSize - slotItem.count)
      : Math.min(1, slotItem.item.maxStackSize - slotItem.count, carriedItem.count);
    if (amountToMove <= 0) return;
    player.inventory.set(
      inventorySlot,
      new ItemStack(slotItem.item, slotItem.count + amountToMove, slotItem.damage),
    );
    player.carriedItem = carriedItem.count === amountToMove
      ? undefined
      : new ItemStack(carriedItem.item, carriedItem.count - amountToMove, carriedItem.damage);
  }

  private dropCarriedItem(player: import('../entities/Player').Player, dropAll: boolean): void {
    const carried = player.carriedItem;
    if (!carried) return;
    const droppedCount = dropAll ? carried.count : 1;
    const dropped = new ItemStack(carried.item, droppedCount, carried.damage);
    const dropEvent = this.plugins?.emit('item:drop', { player, item: dropped, cancelled: false });
    if (dropEvent?.cancelled) return;
    player.carriedItem = carried.count === droppedCount
      ? undefined
      : new ItemStack(carried.item, carried.count - droppedCount, carried.damage);
    const world = this.worldServer.worlds.get(this.worldServer.properties.worldName);
    if (!world) throw new Error(`Player world "${this.worldServer.properties.worldName}" is unavailable`);
    const item = this.entities.add(new ItemEntity(
      this.entities.allocateId(),
      dropped,
      player.x,
      player.y + 1,
      player.z,
    ));
    world.addEntity(item);
    this.broadcastItemDrop(item);
  }

  private broadcastBlockUpdate(x: number, y: number, z: number, blockId: number): void {
    this.broadcast(new TileUpdatePacket(x, y, z, blockId));
  }

  private playerInfoPacket(player: import('../entities/Player').Player): PlayerInfoPacket {
    return new PlayerInfoPacket(
      player.smallId,
      player.playerIndex,
      playerPrivileges(player.gameMode),
      player.id,
    );
  }

  private addPlayerPacket(player: import('../entities/Player').Player): AddPlayerPacket {
    return new AddPlayerPacket(
      player.id,
      player.username,
      player.x,
      player.y,
      player.z,
      player.yaw,
      player.pitch,
      player.playerIndex,
      playerPrivileges(player.gameMode),
    );
  }

  private broadcastItemDrop(item: ItemEntity): void {
    this.broadcast(new SpawnItemEntityPacket(item));
    this.broadcast(new EntityItemMetadataPacket(item));
  }

  private collectNearbyItems(player: import('../entities/Player').Player): void {
    const world = this.worldServer.worlds.get(this.worldServer.properties.worldName);
    if (!world) throw new Error(`Player world "${this.worldServer.properties.worldName}" is unavailable`);
    for (const entity of world.itemEntities.values()) {
      const inventoryBefore = player.inventory.snapshot();
      const pickupEvent = this.plugins?.emit('item:pickup', { player, item: entity, cancelled: false });
      if (pickupEvent?.cancelled) continue;
      if (!this.worldServer.interactions.pickupItem(world, player, entity.id)) continue;
      this.plugins?.emit('item:pickup:complete', { player, item: entity });
      if (!world.entities.has(entity.id)) {
        this.broadcast(new TakeItemEntityPacket(entity.id, player.id));
      } else {
        this.broadcast(new EntityItemMetadataPacket(entity));
      }
      this.syncInventory(player, inventoryBefore);
    }
  }

  private broadcast(packet: GamePacket): void {
    this.players.forEachConnection((connection) => {
      if (!(connection instanceof PacketConnection) || connection.isClosed || !connection.socket.writable) return;
      connection.send(packet);
    });
  }

  private broadcastToOthers(source: PacketConnection, packet: GamePacket): void {
    this.players.forEachConnection((connection) => {
      if (
        connection !== source &&
        connection instanceof PacketConnection &&
        !connection.isClosed &&
        connection.socket.writable
      ) {
        connection.send(packet);
      }
    });
  }
}

function playerPrivileges(gameMode: 'survival' | 'creative'): number {
  const canUseDoorsAndSwitches = 1 << 11;
  const canUseContainers = 1 << 12;
  const creativeMode = gameMode === 'creative' ? 1 << 9 : 0;
  return canUseDoorsAndSwitches | canUseContainers | creativeMode;
}

function containerSlotToInventorySlot(slot: number): number | undefined {
  if (slot >= 9 && slot <= 35) return slot;
  if (slot >= 36 && slot <= 44) return slot - 36;
  return undefined;
}

function stacksEqual(
  left: import('../items/ItemStack').ItemStack | undefined,
  right: import('../items/ItemStack').ItemStack | undefined,
): boolean {
  return left?.item.id === right?.item.id &&
    left?.count === right?.count &&
    left?.damage === right?.damage;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Plugin supplied invalid movement ${name}`);
  }
  return value;
}

function faceOffset(x: number, y: number, z: number, face: number): { x: number; y: number; z: number } {
  switch (face) {
    case 0: return { x, y: y - 1, z };
    case 1: return { x, y: y + 1, z };
    case 2: return { x, y, z: z - 1 };
    case 3: return { x, y, z: z + 1 };
    case 4: return { x: x - 1, y, z };
    case 5: return { x: x + 1, y, z };
    default: throw new RangeError(`Invalid block face ${face}`);
  }
}
