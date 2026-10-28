import { createHash } from 'node:crypto';
import net, { type AddressInfo, type Server as NetServer, type Socket } from 'node:net';
import { BufferWriter } from '../binary';
import {
  buildAddPlayerPacket,
  buildChatPacket,
  buildChunkPacket,
  buildDisconnectPacket,
  buildDroppedItemPackets,
  buildInitialStatePackets,
  buildInventoryPacket,
  buildInventorySlotPacket,
  buildPlayerInfoPacket,
  buildPlayerTeleportPacket,
  buildPlayerPositionPacket,
  buildTakeItemEntityPacket,
  buildPreLoginPacket,
  buildRespawnPacket,
  buildRemovePlayerPacket,
  buildTileUpdatePacket,
  IncompletePacketError,
  NETCODE_VERSION,
  NETWORK_PROTOCOL_VERSION,
  parseClientPacket,
  type ClientPacket,
} from '../protocol';
import { blockCoordinates, getBlock, setBlock, WORLD_HEIGHT } from '../world/chunk';
import { WorldManager } from '../world/manager';
import type { SavedPlayer, World } from '../world/world';
import {
  CommandRegistry,
  EventBus,
  PluginManager,
  PacketRegistry,
  TaskScheduler,
  playerView,
  type OnlinePlayer,
  type PluginGameMode,
  type PluginPacketEvent,
  type PluginServerApi,
  type ServerPlugin,
  type PlayerActionEvent,
} from './plugins';
import {
  BlockRegistry,
  ItemRegistry,
  RecipeRegistry,
  buildCreativeRegistryPacket,
  buildRecipeRegistryPacket,
  createDefaultItemRegistry,
  createDefaultRecipeRegistry,
} from './registry';
import { ModerationStore, normalizeIp, normalizeUsername } from './moderation';
import { createPlayer, snapshotPlayer, type PlayerConnection } from './player';
import { WorldGeneratorRegistry } from './world-generators';
import { EntityRegistry, type ItemEntity } from './entities';
import { insertItemStack, storageIndexFromMenuSlot } from './inventory';

const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PACKETS_PER_SECOND = 10_000;
const MAX_CHUNK_RADIUS = 4;
const FIRST_SMALL_ID = 4;
const REJECT_SMALL_ID = 0xff;
const MAX_WORLD_COORDINATE = 5120;
const MAX_BLOCK_REACH = 6;
const MAX_DROPPED_ITEMS = 4096;
const DROP_PICKUP_DELAY_MS = 500;
const DROP_LIFETIME_MS = 5 * 60 * 1000;

export interface ServerOptions {
  host: string;
  port: number;
  maxPlayers: number;
  world?: World;
  worlds?: WorldManager;
  blocks?: BlockRegistry;
  items?: ItemRegistry;
  recipes?: RecipeRegistry;
  worldGenerators?: WorldGeneratorRegistry;
  plugins?: readonly ServerPlugin[];
  moderation?: ModerationStore;
  moderationFile?: string;
  operators?: readonly string[];
  gameMode?: GameMode;
  maxPacketsPerSecond?: number;
  verbose?: boolean;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type GameMode = 'survival' | 'creative' | 'adventure';

export interface GameServer {
  readonly server: NetServer;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
  playerDeath(username: string, reason: string): void;
}

export function createServer(options: ServerOptions): GameServer {
  const { host, port, maxPlayers } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`Invalid TCP port: ${port}`);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 251) {
    throw new RangeError('maxPlayers must be an integer from 1 to 251');
  }
  const maxPacketsPerSecond = options.maxPacketsPerSecond ?? DEFAULT_MAX_PACKETS_PER_SECOND;
  if (!Number.isInteger(maxPacketsPerSecond) || maxPacketsPerSecond < 1 || maxPacketsPerSecond > 100_000) {
    throw new RangeError('maxPacketsPerSecond must be an integer from 1 to 100000');
  }
  const logger = options.logger ?? console;
  logger.info('[init] Preparing world and server configuration');
  const worlds = resolveWorlds(options);
  logger.info('[init] Initializing block, item, recipe, event, and command registries');
  const blocks = options.blocks ?? new BlockRegistry();
  const recipes = options.recipes ?? createDefaultRecipeRegistry();
  const defaultGameMode = gameModeId(options.gameMode ?? 'survival');
  const items = options.items ?? createDefaultItemRegistry(blocks);
  const worldGenerators = options.worldGenerators ?? new WorldGeneratorRegistry();
  const verbose = options.verbose ?? false;
  const connections = new Set<PlayerConnection>();
  const entities = new EntityRegistry(MAX_DROPPED_ITEMS);
  const freeSmallIds: number[] = [];
  let nextSmallId = FIRST_SMALL_ID;
  let nextEntityId = 1;
  let tps = 20;
  let ticks = 0;
  let tpsWindowStarted = Date.now();
  const moderationReady = options.moderation
    ? Promise.resolve(options.moderation)
    : ModerationStore.load(options.moderationFile ?? 'moderation.json', options.operators);
  let moderationStore: ModerationStore | undefined;
  function playerPrivileges(connection: PlayerConnection): number {
    const operator = moderationStore?.isOperator(connection.player?.name ?? '') ?? false;
    return (operator ? 1 << 4 : 0) | (connection.gameMode === 1 ? 1 << 9 : 0) | (1 << 11) | (1 << 12);
  }

  function dropBlockItem(
    world: World,
    blockId: number,
    position: { x: number; y: number; z: number },
  ): void {
    const block = blocks.get(blockId);
    if (!block || block.drop === false) return;
    const drop = block.drop ?? {
      id: blockId === 1 ? 4 : blockId === 2 ? 3 : blockId,
      count: 1,
      damage: block.damage ?? 0,
    };
    const itemDefinition = items.get(drop.id);
    if (!itemDefinition) {
      logger.warn(`Block ${block.name} has an unregistered drop item ${drop.id}; no item entity was spawned`);
      return;
    }
    let remaining = drop.count ?? 1;
    const itemStackSize = itemDefinition.maxStackSize ?? 64;
    while (remaining > 0) {
      if (entities.size >= MAX_DROPPED_ITEMS) {
        logger.warn('Dropped item limit reached; remaining block drops were skipped');
        return;
      }
      const stack = {
        id: drop.id,
        count: Math.min(remaining, itemStackSize),
        damage: drop.damage ?? itemDefinition.damage ?? 0,
      };
      const dropPosition = { x: position.x + 0.5, y: position.y + 0.5, z: position.z + 0.5 };
      const entityId = nextEntityId++;
      const packets = buildDroppedItemPackets(entityId, stack, dropPosition);
      if (packets.length === 0) return;
      const createdAt = Date.now();
      entities.register<ItemEntity>({
        id: entityId,
        kind: 'item',
        world,
        item: stack,
        position: dropPosition,
        createdAt,
        pickupAfter: createdAt + DROP_PICKUP_DELAY_MS,
        expiresAt: createdAt + DROP_LIFETIME_MS,
      });
      for (const packet of packets) broadcastToWorld(packet, world);
      remaining -= stack.count;
    }
  }

  function collectNearbyDrops(connection: PlayerConnection): boolean {
    const player = connection.player;
    const world = connection.world;
    if (!player || !world || connection.gameMode === 2) return false;
    let collected = false;
    const changedSlots = new Set<number>();
    for (const entity of entities.inWorld(world)) {
      if (entity.kind !== 'item') continue;
      const drop = entity;
      if (Date.now() < drop.pickupAfter) continue;
      const dx = player.x - drop.position.x;
      const dy = player.y - drop.position.y;
      const dz = player.z - drop.position.z;
      if (dx * dx + dy * dy + dz * dz > 2.25) continue;
      const changed = insertItemStack(
        player.inventory,
        drop.item,
        items.get(drop.item.id)?.maxStackSize ?? 64,
      );
      if (!changed) continue;
      changed.forEach((slot) => changedSlots.add(slot));
      entities.remove(drop.id);
      broadcastToWorld(buildTakeItemEntityPacket(drop.id, connection.entityId), world);
      collected = true;
    }
    if (collected) {
      for (const slot of changedSlots) {
        writeFrame(connection, buildInventorySlotPacket(slot, player.inventory[slot]));
      }
      world.setPlayer(player);
      saveSoon(world);
    }
    return collected;
  }

  function refreshPlayerPrivileges(username: string): void {
    for (const playerConnection of connections) {
      if (
        playerConnection.state !== 'joined' ||
        normalizeUsername(playerConnection.player?.name ?? '') !== normalizeUsername(username)
      ) continue;
      const packet = buildPlayerInfoPacket(
        playerConnection.smallId,
        playerConnection.playerIndex,
        playerConnection.entityId,
        playerPrivileges(playerConnection),
      );
      if (playerConnection.world) broadcastToWorld(packet, playerConnection.world);
      else writeFrame(playerConnection, packet);
    }
  }

  const reportPluginError = (message: string, error: unknown): void => {
    logger.error(`${message}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  };
  const events = new EventBus(reportPluginError);
  const scheduler = new TaskScheduler(reportPluginError);
  const commands = new CommandRegistry();
  const packets = new PacketRegistry();
  const pluginManager = new PluginManager({
    server: createPluginServerApi(),
    blocks,
    items,
    recipes,
    worldGenerators,
    events,
    scheduler,
    commands,
    packets,
    log: (message) => logger.info(`[plugin] ${message}`),
  }, reportPluginError);
  registerBuiltInCommands();
  logger.info(`[init] Loading and enabling ${options.plugins?.length ?? 0} plugin(s)`);
  pluginManager.enable(options.plugins ?? []);
  logger.info('[init] Configuring world terrain generators');
  for (const world of worlds.all()) {
    const generator = worldGenerators.get(world.generatorName);
    if (!generator) {
      throw new Error(
        `World "${world.name}" references unknown generator "${world.generatorName}". ` +
        `Available generators: ${worldGenerators.names().join(', ')}`,
      );
    }
    world.setChunkGenerator(generator);
  }
  worldGenerators.seal();
  logger.info('[init] Registering blocks with the item registry');
  for (const block of blocks.values()) items.registerBlock(block);
  logger.info('[init] Validating and sealing registries');
  blocks.creativePayload();
  items.creativePayload();
  recipes.payload();
  blocks.seal();
  items.seal();
  recipes.seal();
  logger.info('[init] Registries ready');

  const server = net.createServer((socket) => {
    const remoteIp = normalizeIp(socket.remoteAddress ?? '') ?? '';
    void moderationReady.then((moderation) => {
      if (socket.destroyed) return;
      const reason = moderation.isIpBanned(remoteIp);
      if (reason) {
        logger.warn(`Rejected banned IP ${remoteIp}: ${reason}`);
        socket.end(Buffer.concat([Buffer.from([REJECT_SMALL_ID]), framed(buildDisconnectPacket(44))]));
        return;
      }
      acceptConnection(socket);
    }).catch((error: unknown) => {
      reportPluginError('Unable to load moderation data', error);
      socket.destroy();
    });
  });

  function acceptConnection(socket: Socket): void {
    const connection: PlayerConnection = {
      socket,
      state: 'pre-login',
      transportBuffer: Buffer.alloc(0),
      packetBuffer: Buffer.alloc(0),
      smallId: -1,
      playerIndex: -1,
      entityId: -1,
      gameMode: defaultGameMode,
      localXuid: 0n,
      packetWindowStartedAt: Date.now(),
      packetWindowCount: 0,
      player: undefined,
      world: undefined,
      breakTarget: undefined,
      chunksSent: new Set<string>(),
    };
    connections.add(connection);
    socket.setNoDelay(true);

    if (freeSmallIds.length === 0 && nextSmallId > 254) {
      logger.info(`Rejected connection from ${socket.remoteAddress}: no SmallIDs available`);
      socket.end(Buffer.concat([Buffer.from([REJECT_SMALL_ID]), buildDisconnectPacket(26)]));
      connections.delete(connection);
      return;
    }

    connection.smallId = freeSmallIds.pop() ?? nextSmallId++;
    socket.write(Buffer.from([connection.smallId]));
    logger.info(`TCP client connected from ${socket.remoteAddress}, assigned SmallID ${connection.smallId}`);

    socket.on('data', (data) => {
      const received = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      connection.transportBuffer = Buffer.concat([connection.transportBuffer, received]);
      if (connection.transportBuffer.length > MAX_PENDING_BYTES) {
        logger.warn(`Closing ${socket.remoteAddress}: buffered TCP frames exceed limit`);
        socket.destroy();
        return;
      }
      readTransportFrames(connection);
    });
    socket.on('error', (error) => logger.warn(`Socket error from ${socket.remoteAddress}: ${error.message}`));
    socket.on('close', () => handleClose(connection));
  }

  function writeFrame(connection: PlayerConnection, packet: Buffer): void {
    if (packet.length > MAX_FRAME_BYTES) {
      logger.error(`Refusing oversized server packet (${packet.length} bytes) for ${connection.player?.name ?? connection.socket.remoteAddress}`);
      return;
    }
    if (connection.socket.destroyed || connection.socket.writableEnded) return;
    if (!dispatchPacketEvent(connection, 'outgoing', packet)) return;
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(packet.length);
    connection.socket.write(Buffer.concat([header, packet]));
    if (verbose) logger.info(`[packet:out] ${connection.player?.name ?? connection.socket.remoteAddress} id=${packet[0]} bytes=${packet.length}`);
  }

  function readTransportFrames(connection: PlayerConnection): void {
    while (connection.transportBuffer.length >= 4 && !connection.socket.destroyed) {
      const length = connection.transportBuffer.readUInt32BE(0);
      if (length < 1 || length > MAX_FRAME_BYTES) {
        logger.warn(`Closing ${connection.socket.remoteAddress}: invalid frame length ${length}`);
        connection.socket.destroy();
        return;
      }
      if (connection.transportBuffer.length < length + 4) return;
      const payload = connection.transportBuffer.subarray(4, length + 4);
      connection.transportBuffer = connection.transportBuffer.subarray(length + 4);
      connection.packetBuffer = Buffer.concat([connection.packetBuffer, payload]);
      if (connection.packetBuffer.length > MAX_PENDING_BYTES) {
        logger.warn(`Closing ${connection.socket.remoteAddress}: buffered game packets exceed limit`);
        connection.socket.destroy();
        return;
      }
      readPackets(connection);
    }
  }

  function readPackets(connection: PlayerConnection): void {
    while (connection.packetBuffer.length > 0 && !connection.socket.destroyed) {
      const packetId = connection.packetBuffer[0];
      if (packets.isDeclined(packetId)) {
        const playerName = connection.player?.name ?? connection.socket.remoteAddress ?? 'unknown client';
        logger.warn(`Kicking ${playerName}: packet ID ${packetId} is declined by a plugin`);
        kickConnection(connection, `Packet ID ${packetId} is not allowed`);
        return;
      }
      let packet: ClientPacket;
      try {
        packet = parseClientPacket(connection.packetBuffer, connection.state === 'joined');
      } catch (error) {
        if (error instanceof IncompletePacketError) return;
        logger.warn(`Closing ${connection.socket.remoteAddress}: ${(error as Error).message}`);
        connection.socket.destroy();
        return;
      }
      if (!allowPacketRate(connection)) {
        logger.warn(
          `Closing ${connection.player?.name ?? connection.socket.remoteAddress}: ` +
          `client packet rate exceeded limit (id=${packet.id}, count=${connection.packetWindowCount}/${maxPacketsPerSecond} per second)`,
        );
        connection.socket.destroy();
        return;
      }
      const packetBytes = connection.packetBuffer.subarray(0, packet.bytesRead);
      connection.packetBuffer = connection.packetBuffer.subarray(packet.bytesRead);
      if (verbose) logger.info(`[packet:in] ${connection.player?.name ?? connection.socket.remoteAddress} id=${packet.id} bytes=${packet.bytesRead}`);
      if (!dispatchPacketEvent(connection, 'incoming', packetBytes, packet)) continue;
      try {
        if (connection.state === 'pre-login') {
          handlePreLogin(connection, packet);
        } else if (connection.state === 'login') {
          handleLogin(connection, packet);
        } else {
          handleJoinedPacket(connection, packet);
        }
      } catch (error) {
        logger.error(
          `Closing ${connection.player?.name ?? connection.socket.remoteAddress}: packet handling failed: ` +
          `${error instanceof Error ? error.stack ?? error.message : String(error)}`,
        );
        connection.socket.destroy();
      }
    }
  }

  function handlePreLogin(connection: PlayerConnection, packet: ClientPacket): void {
    if (packet.id !== 2) {
      logger.warn('Expected pre-login packet ID 2');
      connection.socket.destroy();
      return;
    }
    if (packet.netcodeVersion !== NETCODE_VERSION) {
      logger.info(`Rejected client with network build ${packet.netcodeVersion}; expected ${NETCODE_VERSION}`);
      writeFrame(connection, buildDisconnectPacket(packet.netcodeVersion! > NETCODE_VERSION ? 27 : 28));
      connection.socket.end();
      return;
    }
    writeFrame(connection, buildPreLoginPacket());
    connection.state = 'login';
  }

  function handleLogin(connection: PlayerConnection, packet: ClientPacket): void {
    if (packet.id !== 1) {
      logger.warn('Expected login packet ID 1');
      connection.socket.destroy();
      return;
    }
    if (packet.clientVersion !== NETWORK_PROTOCOL_VERSION) {
      logger.info(`Rejected ${packet.username}: protocol ${packet.clientVersion}; expected ${NETWORK_PROTOCOL_VERSION}`);
      writeFrame(connection, buildDisconnectPacket(packet.clientVersion! > NETWORK_PROTOCOL_VERSION ? 27 : 28));
      connection.socket.end();
      return;
    }

    const activePlayers = [...connections].filter((client) => client.state === 'joined');
    const name = packet.username!.trim();
    const moderation = moderationStore;
    if (!moderation) {
      logger.error('Moderation data was not ready before login');
      connection.socket.destroy();
      return;
    }
    if (!isValidUsername(name)) {
      writeFrame(connection, buildDisconnectPacket(44));
      connection.socket.end();
      return;
    }
    const banReason = moderation.isUsernameBanned(name);
    if (banReason) {
      logger.warn(`Rejected banned username ${name}: ${banReason}`);
      writeFrame(connection, buildDisconnectPacket(44));
      connection.socket.end();
      return;
    }
    if (activePlayers.length >= maxPlayers || activePlayers.some((client) => client.player && normalizeUsername(client.player.name) === normalizeUsername(name))) {
      writeFrame(connection, buildDisconnectPacket(activePlayers.length >= maxPlayers ? 26 : 44));
      connection.socket.end();
      return;
    }

    connection.playerIndex = allocatePlayerIndex(activePlayers, maxPlayers);
    connection.entityId = nextEntityId++;
    connection.world = worlds.first();
    connection.localXuid = xuidFromUsername(name);
    connection.player = createPlayer(name, connection.world.players.get(normalizeUsername(name)));
    connection.gameMode = defaultGameMode;
    connection.state = 'joined';
    const player = connection.player;
    connection.world.getChunk(0, 0);

    writeFrame(connection, buildInitialStatePackets(
      maxPlayers,
      connection.playerIndex,
      connection.world.seed,
      player,
      connection.world.dimension,
      connection.gameMode,
      playerPrivileges(connection),
    ));
    streamNearbyChunks(connection);
    writeFrame(connection, buildCreativeRegistryPacket(items));
    writeFrame(connection, buildRecipeRegistryPacket(recipes));
    for (const entity of entities.inWorld(connection.world)) {
      if (entity.kind !== 'item') continue;
      const drop = entity;
      for (const packet of buildDroppedItemPackets(drop.id, drop.item, drop.position)) writeFrame(connection, packet);
    }

    for (const other of activePlayers) {
      if (!other.player || other.world !== connection.world) continue;
      writeFrame(connection, buildPlayerInfoPacket(other.smallId, other.playerIndex, other.entityId, playerPrivileges(other)));
      writeFrame(connection, buildAddPlayerPacket(other.player, other.entityId, other.playerIndex));
      writeFrame(other, buildPlayerInfoPacket(connection.smallId, connection.playerIndex, connection.entityId, playerPrivileges(connection)));
      writeFrame(other, buildAddPlayerPacket(player, connection.entityId, connection.playerIndex));
    }

    const joined = buildChatPacket(`${player.name} joined the game.`);
    broadcast(joined);
    connection.world.setPlayer(player);
    events.emit('playerJoin', { player: playerViewOf(connection) });
    saveSoon(connection.world);
    logger.info(`${player.name} joined world=${connection.world.name} (${activePlayers.length + 1}/${maxPlayers})`);
  }

  function handleJoinedPacket(connection: PlayerConnection, packet: ClientPacket): void {
    const player = connection.player;
    const world = connection.world;
    if (!player || !world) return;
    if (packet.disconnected) {
      connection.socket.end();
      return;
    }
    if (!dispatchPlayerAction(connection, packet)) return;
    if (packet.customPayload) {
      const payload = {
        player: playerViewOf(connection),
        channel: packet.customPayload.channel,
        data: Buffer.from(packet.customPayload.data),
      };
      if (!events.emit('customPayload', payload, true)) return;
    }
    if (packet.position) {
      const { x, y, yView, z } = packet.position;
      if (
        ![x, y, yView, z].every(Number.isFinite) ||
        (packet.rotation && ![packet.rotation.yaw, packet.rotation.pitch].every(Number.isFinite)) ||
        Math.abs(x) > MAX_WORLD_COORDINATE ||
        Math.abs(z) > MAX_WORLD_COORDINATE ||
        yView < -64 ||
        yView > WORLD_HEIGHT + 64 ||
        Math.abs(x - player.x) > 64 ||
        Math.abs(yView - player.y) > 64 ||
        Math.abs(z - player.z) > 64
      ) {
        logger.warn(`Closing ${player.name}: invalid player position`);
        connection.socket.destroy();
        return;
      }
      const previous = { x: player.x, y: player.y, z: player.z };
      const next = { x, y: yView, z };
      if (!events.emit('playerMove', {
        player: playerViewOf(connection),
        from: Object.freeze(previous),
        to: Object.freeze(next),
      }, true)) {
        writeFrame(connection, buildPlayerPositionPacket(player));
        return;
      }
      player.x = x;
      player.y = yView;
      player.z = z;
      if (packet.rotation) {
        player.yaw = packet.rotation.yaw;
        player.pitch = packet.rotation.pitch;
      }
      collectNearbyDrops(connection);
      broadcastMovement(connection);
      streamNearbyChunks(connection);
      world.setPlayer(player);
      saveSoon(world);
    } else if (packet.rotation) {
      if (![packet.rotation.yaw, packet.rotation.pitch].every(Number.isFinite)) {
        logger.warn(`Closing ${player.name}: invalid player rotation`);
        connection.socket.destroy();
        return;
      }
      player.yaw = packet.rotation.yaw;
      player.pitch = packet.rotation.pitch;
      broadcastMovement(connection);
      world.setPlayer(player);
      saveSoon(world);
    } else if (packet.id === 14) {
      handleBlockAction(connection, packet);
    } else if (packet.id === 15) {
      handleBlockPlacement(connection, packet);
    } else if (packet.id === 16 && packet.selectedSlot !== undefined) {
      if (packet.selectedSlot >= 0 && packet.selectedSlot < 9) player.selectedSlot = packet.selectedSlot;
    } else if (packet.id === 107 && packet.creativeSlot !== undefined) {
      setInventorySlot(connection, packet.creativeSlot, packet.item);
    } else if (packet.id === 3 && packet.chat !== undefined) {
      const message = packet.chat.trim().slice(0, 255);
      if (message) {
        if (message.startsWith('/')) {
          const commandEvent = {
            player: playerViewOf(connection),
            command: message,
            cancelled: false,
          };
          if (!events.emit('playerCommand', commandEvent, true) || commandEvent.cancelled) return;
          void runCommand(connection, message);
          return;
        }
        if (!events.emit('playerChat', { player: playerViewOf(connection), message }, true)) return;
        logger.info(`<${player.name}> ${message}`);
        broadcast(buildChatPacket(`<${player.name}> ${message}`));
      }
    } else if (packet.id === 0 && packet.keepAliveId !== undefined) {
      writeFrame(connection, Buffer.from([0, ...int32Bytes(packet.keepAliveId)]));
    }
  }

  function dispatchPlayerAction(connection: PlayerConnection, packet: ClientPacket): boolean {
    if (!connection.player || !connection.world) return false;
    const actions: Record<number, Exclude<PlayerActionEvent['action'], 'custom-payload'>> = {
      10: 'swing',
      14: 'block-action',
      15: 'block-place',
      18: 'entity-action',
      19: 'entity-interaction',
    };
    const action = actions[packet.id];
    if (!action) return true;
    return events.emit('playerAction', {
      player: playerViewOf(connection),
      action,
      packetId: packet.id,
      packet: freezeClientPacket(packet),
    }, true);
  }

  function handleBlockAction(connection: PlayerConnection, packet: ClientPacket): void {
    const player = connection.player;
    const world = connection.world;
    if (!player || !world || connection.gameMode === 2) return;
    if (packet.action === 0) {
      const target = blockPosition(packet);
      if (!target || !validBlockPosition(target) || !canReach(player, target)) {
        connection.breakTarget = undefined;
        return;
      }
      connection.breakTarget = target;
      return;
    }
    if (packet.action !== 2) return;
    const target = blockPosition(packet);
    if (!target || !sameBlock(target, connection.breakTarget) || !canReach(player, target) || !validBlockPosition(target)) {
      connection.breakTarget = undefined;
      return;
    }
    const { chunkX, chunkZ } = blockCoordinates(target.x, target.z);
    const chunk = world.getChunk(chunkX, chunkZ);
    const blockId = getBlock(chunk, target.x, target.y, target.z);
    if (blockId !== 0 && blockId !== 7) {
      if (!events.emit('blockBreak', {
        player: playerViewOf(connection),
        world,
        position: Object.freeze({ ...target }),
        blockId,
      }, true)) {
        connection.breakTarget = undefined;
        return;
      }
      setBlock(chunk, target.x, target.y, target.z, 0);
      broadcastToWorld(buildTileUpdatePacket(target.x, target.y, target.z, 0), world);
      if (connection.gameMode === 0) dropBlockItem(world, blockId, target);
      saveSoon(world);
    }
    connection.breakTarget = undefined;
  }

  function handleBlockPlacement(connection: PlayerConnection, packet: ClientPacket): void {
    const player = connection.player;
    const world = connection.world;
    if (!player || !world || connection.gameMode === 2 || packet.face === undefined || packet.face === 255) return;
    const stack = player.inventory[player.selectedSlot];
    const definition = stack && blocks.get(stack.id);
    if (!stack || !definition || definition.placeable === false) return;
    const offset = faceOffset(packet.face);
    if (!offset) return;
    const clicked = blockPosition(packet);
    if (!clicked) return;
    const target = {
      x: clicked.x + offset.x,
      y: clicked.y + offset.y,
      z: clicked.z + offset.z,
    };
    if (!validBlockPosition(target) || !canReach(player, target)) return;
    const { chunkX, chunkZ } = blockCoordinates(target.x, target.z);
    const chunk = world.getChunk(chunkX, chunkZ);
    if (getBlock(chunk, target.x, target.y, target.z) !== 0) return;
    if (!events.emit('blockPlace', {
      player: playerViewOf(connection),
      world,
      position: Object.freeze({ ...target }),
      blockId: stack.id,
    }, true)) return;

    setBlock(chunk, target.x, target.y, target.z, stack.id);
    if (connection.gameMode === 0) {
      stack.count -= 1;
      if (stack.count <= 0) player.inventory[player.selectedSlot] = null;
    }
    broadcastToWorld(buildTileUpdatePacket(target.x, target.y, target.z, stack.id), world);
    writeFrame(connection, buildInventorySlotPacket(player.selectedSlot, player.inventory[player.selectedSlot]));
    world.setPlayer(player);
    saveSoon(world);
  }

  function setInventorySlot(connection: PlayerConnection, slot: number, item: ClientPacket['item']): void {
    const player = connection.player;
    const world = connection.world;
    const storageSlot = storageIndexFromMenuSlot(slot);
    if (!player || !world) return;
    if (storageSlot === undefined) {
      writeFrame(connection, buildInventoryPacket(player.inventory));
      logger.warn(`Rejected creative inventory slot ${slot} from ${player.name}`);
      return;
    }
    if (connection.gameMode !== 1) {
      writeFrame(connection, buildInventoryPacket(player.inventory));
      logger.warn(`Rejected creative inventory packet from non-creative player ${player.name}`);
      return;
    }
    if (item) {
      const definition = items.get(item.id);
      if (!definition || item.damage !== (definition.damage ?? 0) || item.count < 1 || item.count > (definition.maxStackSize ?? 64)) {
        logger.warn(`Rejected invalid creative item from ${player.name}: id=${item.id}, damage=${item.damage}, count=${item.count}`);
        writeFrame(connection, buildInventoryPacket(player.inventory));
        return;
      }
      player.inventory[storageSlot] = { id: item.id, count: item.count, damage: item.damage };
    } else {
      player.inventory[storageSlot] = null;
    }
    writeFrame(connection, buildInventoryPacket(player.inventory));
    world.setPlayer(player);
    saveSoon(world);
  }

  function streamNearbyChunks(connection: PlayerConnection): void {
    if (!connection.player || !connection.world || connection.socket.destroyed) return;
    const centerX = Math.floor(connection.player.x / 16);
    const centerZ = Math.floor(connection.player.z / 16);
    for (let dz = -MAX_CHUNK_RADIUS; dz <= MAX_CHUNK_RADIUS; dz += 1) {
      for (let dx = -MAX_CHUNK_RADIUS; dx <= MAX_CHUNK_RADIUS; dx += 1) {
        const x = centerX + dx;
        const z = centerZ + dz;
        const key = `${x},${z}`;
        if (connection.chunksSent.has(key)) continue;
        const chunk = connection.world.getChunk(x, z);
        writeFrame(connection, buildChunkPacket(chunk));
        connection.chunksSent.add(key);
      }
    }
  }

  function playerViewOf(connection: PlayerConnection): OnlinePlayer {
    if (!connection.player || !connection.world) throw new Error('Player is not in a world');
    return playerView(
      connection.player.name,
      connection.localXuid,
      connection.player,
      connection.world,
      (message) => writeFrame(connection, buildChatPacket(message.slice(0, 255))),
    );
  }

  function createPluginServerApi(): PluginServerApi {
    return {
      worlds,
      entities,
      getWorld: (name) => worlds.get(name),
      getWorlds: () => worlds.all(),
      getPlayer: (username) => {
        const connection = findOnlineConnection(username);
        return connection ? playerViewOf(connection) : undefined;
      },
      getOnlinePlayers: () => [...connections]
        .filter((connection) => connection.state === 'joined' && connection.player && connection.world)
        .map((connection) => playerViewOf(connection)),
      getTps: () => tps,
      broadcast: (message) => broadcast(buildChatPacket(message.slice(0, 255))),
      changeWorld: async (username, worldName) => {
        const connection = findOnlineConnection(username);
        const target = worlds.get(worldName);
        if (!connection || !target) return false;
        await switchWorld(connection, target);
        return true;
      },
      kickPlayer: (username, reason = 'Kicked by a plugin') => {
        const connection = findOnlineConnection(username);
        if (!connection?.player || !connection.world) return false;
        const message = reason.trim().slice(0, 160) || 'Kicked by a plugin';
        logger.info(`Kicking ${connection.player.name}: ${message}`);
        kickConnection(connection, message);
        return true;
      },
      setGameMode: (username, gameMode) => {
        const connection = findOnlineConnection(username);
        return connection ? setPlayerGameMode(connection, gameModeId(gameMode)) : false;
      },
      saveWorld: async (name) => {
        const world = worlds.get(name);
        if (!world) return false;
        await world.save();
        return true;
      },
      playerDeath: (username, reason) => emitPlayerDeath(username, reason),
    };
  }

  function findOnlineConnection(username: string): PlayerConnection | undefined {
    const normalized = normalizeUsername(username);
    return [...connections].find((candidate) =>
      candidate.state === 'joined' && normalizeUsername(candidate.player?.name ?? '') === normalized);
  }

  function dispatchPacketEvent(
    connection: PlayerConnection,
    direction: PluginPacketEvent['direction'],
    packetBytes: Buffer,
    packet?: ClientPacket,
  ): boolean {
    const event: PluginPacketEvent = {
      direction,
      player: connection.player && connection.world ? playerViewOf(connection) : undefined,
      packetId: packet?.id ?? packetBytes[0],
      packet: packet && !packet.unsupported ? freezeClientPacket(packet) : undefined,
      unsupported: packet?.unsupported ?? false,
      data: Buffer.from(packetBytes),
      cancelled: false,
    };
    const allowed = events.emit('packet', event, true);
    return allowed && !event.cancelled;
  }

  async function runCommand(connection: PlayerConnection, input: string): Promise<void> {
    const [rawName, ...args] = input.slice(1).trim().split(/\s+/);
    if (!rawName) return;
    const command = commands.get(rawName);
    const player = connection.player;
    if (!command || !player) {
      writeFrame(connection, buildChatPacket(`Unknown command: /${rawName}. Try /help.`));
      return;
    }
    const moderation = moderationStore;
    if (!moderation) throw new Error('Moderation data was not ready for command execution');
    const isOperator = moderation.isOperator(player.name);
    if (command.operatorOnly && !isOperator) {
      writeFrame(connection, buildChatPacket('You do not have permission to use that command.'));
      return;
    }
    try {
      await command.execute({
        sender: playerViewOf(connection),
        args,
        isOperator,
        reply: (message) => writeFrame(connection, buildChatPacket(message.slice(0, 255))),
      });
    } catch (error) {
      reportPluginError(`Command /${command.name} failed for ${player.name}`, error);
      writeFrame(connection, buildChatPacket(`Command failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  async function switchWorld(connection: PlayerConnection, target: World): Promise<void> {
    const source = connection.world;
    const player = connection.player;
    if (!source || !player || source === target || connection.state !== 'joined') return;

    source.setPlayer(snapshotPlayer(player));
    const activePlayers = [...connections].filter((client) => client.state === 'joined');
    for (const other of activePlayers) {
      if (other !== connection && other.world === source) {
        writeFrame(other, buildRemovePlayerPacket(connection.entityId));
      }
    }

    const bridge = worlds.transitionBridgeWorld(source, target);
    if (source.dimension === 0 && target.dimension === 0) {
      writeFrame(connection, buildRespawnPacket(-1, bridge?.seed ?? source.seed, connection.entityId, connection.gameMode));
    }
    const targetSaved = target.players.get(normalizeUsername(player.name));
    const nextPlayer = createPlayer(player.name, targetSaved);
    nextPlayer.inventory = player.inventory.map((item) => item && { ...item });
    nextPlayer.selectedSlot = player.selectedSlot;
    connection.player = nextPlayer;
    connection.world = target;
    connection.chunksSent.clear();
    target.getChunk(0, 0);

    writeFrame(connection, buildRespawnPacket(target.dimension, target.seed, connection.entityId, connection.gameMode));
    writeFrame(connection, buildSpawnPositionPacket());
    writeFrame(connection, buildInventoryPacket(nextPlayer.inventory));
    writeFrame(connection, buildPlayerPositionPacket(nextPlayer));
    streamNearbyChunks(connection);
    for (const entity of entities.inWorld(target)) {
      if (entity.kind !== 'item') continue;
      const drop = entity;
      for (const packet of buildDroppedItemPackets(drop.id, drop.item, drop.position)) writeFrame(connection, packet);
    }

    for (const other of activePlayers) {
      if (other === connection || other.world !== target || !other.player) continue;
      writeFrame(connection, buildPlayerInfoPacket(other.smallId, other.playerIndex, other.entityId, playerPrivileges(other)));
      writeFrame(connection, buildAddPlayerPacket(other.player, other.entityId, other.playerIndex));
      writeFrame(other, buildPlayerInfoPacket(connection.smallId, connection.playerIndex, connection.entityId, playerPrivileges(connection)));
      writeFrame(other, buildAddPlayerPacket(nextPlayer, connection.entityId, connection.playerIndex));
    }
    target.setPlayer(nextPlayer);
    events.emit('worldChange', { player: playerViewOf(connection), from: source, to: target });
    broadcast(buildChatPacket(`${player.name} entered world ${target.name}.`));
    saveSoon(source);
    saveSoon(target);
    logger.info(`${player.name} changed world ${source.name} -> ${target.name}`);
  }

  function broadcastMovement(moving: PlayerConnection): void {
    if (!moving.player || !moving.world) return;
    const packet = buildPlayerTeleportPacket(moving.player, moving.entityId);
    for (const client of connections) {
      if (client !== moving && client.state === 'joined' && client.world === moving.world) writeFrame(client, packet);
    }
  }

  function broadcast(packet: Buffer): void {
    for (const client of connections) {
      if (client.state === 'joined') writeFrame(client, packet);
    }
  }

  function broadcastToWorld(packet: Buffer, world: World): void {
    for (const client of connections) {
      if (client.state === 'joined' && client.world === world) writeFrame(client, packet);
    }
  }

  function handleClose(connection: PlayerConnection): void {
    connections.delete(connection);
    if (connection.smallId >= FIRST_SMALL_ID) freeSmallIds.push(connection.smallId);
    if (!connection.player || !connection.world) return;
    const player = snapshotPlayer(connection.player);
    connection.world.setPlayer(player);
    for (const other of connections) {
      if (other.state === 'joined' && other.world === connection.world) writeFrame(other, buildRemovePlayerPacket(connection.entityId));
    }
    broadcast(buildChatPacket(`${player.name} left the game.`));
    events.emit('playerLeave', { player: playerView(player.name, connection.localXuid, player, connection.world, () => {}) });
    saveSoon(connection.world);
    logger.info(`${player.name} disconnected`);
  }

  function saveSoon(world: World): void {
    world.scheduleSave((error) => logger.error(`World save failed for ${world.name}: ${error.message}`));
  }

  function allocatePlayerIndex(active: PlayerConnection[], limit: number): number {
    const used = new Set(active.map((connection) => connection.playerIndex));
    for (let index = 0; index < limit; index += 1) {
      if (!used.has(index)) return index;
    }
    return 0;
  }

  function allowPacketRate(connection: PlayerConnection): boolean {
    const now = Date.now();
    if (now - connection.packetWindowStartedAt >= 1000) {
      connection.packetWindowStartedAt = now;
      connection.packetWindowCount = 0;
    }
    connection.packetWindowCount += 1;
    return connection.packetWindowCount <= maxPacketsPerSecond;
  }

  function registerBuiltInCommands(): void {
    commands.register({
      name: 'help',
      description: 'List available commands.',
      execute: ({ isOperator, reply }) => {
        const available = commands.values().filter((command) => !command.operatorOnly || isOperator);
        for (const command of available) reply(`/${command.name} - ${command.description}`);
      },
    });
    commands.register({
      name: 'gamemode',
      description: "Change your game mode or another player's game mode.",
      operatorOnly: true,
      execute: ({ sender, args, reply }) => {
        const [rawMode, targetName] = args;
        const mode = parseGameModeArgument(rawMode);
        const senderConnection = [...connections].find((candidate) =>
          candidate.state === 'joined' &&
          normalizeUsername(candidate.player?.name ?? '') === normalizeUsername(sender.name));
        const target = targetName
          ? [...connections].find((candidate) =>
            candidate.state === 'joined' &&
            normalizeUsername(candidate.player?.name ?? '') === normalizeUsername(targetName))
          : senderConnection;
        if (!target?.player || !target.world) {
          reply(targetName ? `Player "${targetName}" is not online.` : 'Unable to find your player session.');
          return;
        }
        if (!setPlayerGameMode(target, mode)) {
          reply(`Could not change ${target.player.name}'s game mode.`);
          return;
        }
        const description = ['survival', 'creative', 'adventure'][mode];
        reply(target === senderConnection
          ? `Your game mode is now ${description}.`
          : `Set ${target.player.name} to ${description} mode.`);
      },
    });
    commands.register({
      name: 'tps',
      description: 'Show server tick rate and online player count.',
      execute: ({ reply }) => {
        const online = [...connections].filter((connection) => connection.state === 'joined').length;
        reply(`TPS: ${tps.toFixed(1)} / 20.0 | Players: ${online}/${maxPlayers}`);
      },
    });
    commands.register({
      name: 'world',
      description: 'List worlds or move a player to a named world.',
      operatorOnly: true,
      execute: async ({ sender, args, reply }) => {
        if (args.length === 0) {
          reply(`Worlds: ${worlds.names().join(', ')}`);
          return;
        }
        const target = worlds.get(args[0]);
        if (!target) {
          reply(`Unknown world "${args[0]}". Worlds: ${worlds.names().join(', ')}`);
          return;
        }
        await createPluginServerApi().changeWorld(sender.name, target.name);
      },
    });
    commands.register({
      name: 'op',
      description: 'Grant operator privileges to a username.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /op <username>');
        await (await moderationReady).setOperator(args[0], true);
        refreshPlayerPrivileges(args[0]);
        reply(`Granted operator privileges to ${args[0]}.`);
      },
    });
    commands.register({
      name: 'deop',
      description: 'Remove operator privileges from a username.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /deop <username>');
        await (await moderationReady).setOperator(args[0], false);
        refreshPlayerPrivileges(args[0]);
        reply(`Removed operator privileges from ${args[0]}.`);
      },
    });
    commands.register({
      name: 'ban',
      description: 'Ban a username and disconnect them if online.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /ban <username> [reason]');
        await (await moderationReady).banUsername(args[0], args.slice(1).join(' '));
        kickMatching((candidate) => normalizeUsername(candidate.player?.name ?? '') === normalizeUsername(args[0]));
        reply(`Banned ${args[0]}.`);
      },
    });
    commands.register({
      name: 'pardon',
      description: 'Remove a username ban.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /pardon <username>');
        await (await moderationReady).pardonUsername(args[0]);
        reply(`Unbanned ${args[0]}.`);
      },
    });
    commands.register({
      name: 'banip',
      description: 'Ban an IP address and disconnect matching clients.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /banip <address> [reason]');
        await (await moderationReady).banIp(args[0], args.slice(1).join(' '));
        const address = normalizeIp(args[0]);
        kickMatching((candidate) => normalizeIp(candidate.socket.remoteAddress ?? '') === address);
        reply(`Banned IP ${args[0]}.`);
      },
    });
    commands.register({
      name: 'unbanip',
      description: 'Remove an IP address ban.',
      operatorOnly: true,
      execute: async ({ args, reply }) => {
        if (!args[0]) throw new Error('Usage: /unbanip <address>');
        await (await moderationReady).pardonIp(args[0]);
        reply(`Unbanned IP ${args[0]}.`);
      },
    });
  }

  function kickMatching(matches: (connection: PlayerConnection) => boolean): void {
    for (const connection of connections) {
      if (connection.state !== 'joined' || !matches(connection)) continue;
      kickConnection(connection, 'Disconnected by server moderation');
    }
  }

  function kickConnection(connection: PlayerConnection, reason: string): void {
    if (connection.socket.destroyed || connection.socket.writableEnded) return;
    if (connection.player && connection.world) {
      events.emit('playerKick', { player: playerViewOf(connection), reason });
    }
    writeFrame(connection, buildDisconnectPacket(44));
    connection.socket.end();
  }

  function setPlayerGameMode(connection: PlayerConnection, mode: 0 | 1 | 2): boolean {
    const player = connection.player;
    const world = connection.world;
    if (!player || !world) return false;
    const from = gameModeName(connection.gameMode);
    const to = gameModeName(mode);
    if (connection.gameMode === mode) return true;
    if (!events.emit('playerGameModeChange', { player: playerViewOf(connection), from, to }, true)) return false;
    connection.gameMode = mode;
    writeFrame(connection, new BufferWriter().byte(70).byte(3).byte(mode).build());
    writeFrame(connection, buildInventoryPacket(player.inventory));
    for (const client of connections) {
      if (client.state === 'joined' && client.world === world) {
        writeFrame(client, buildPlayerInfoPacket(
          connection.smallId,
          connection.playerIndex,
          connection.entityId,
          playerPrivileges(connection),
        ));
      }
    }
    world.setPlayer(player);
    saveSoon(world);
    return true;
  }

  function buildSpawnPositionPacket(): Buffer {
    return new BufferWriter().byte(6).int(0).int(4).int(0).build();
  }

  function emitPlayerDeath(username: string, reason: string): void {
    const connection = [...connections].find((candidate) =>
      candidate.state === 'joined' && normalizeUsername(candidate.player?.name ?? '') === normalizeUsername(username));
    if (!connection?.player || !connection.world) return;
    events.emit('playerDeath', { player: playerViewOf(connection), reason: reason.slice(0, 160) });
  }

  const tpsTimer = setInterval(() => {
    ticks += 1;
    const now = Date.now();
    const elapsed = now - tpsWindowStarted;
    if (elapsed >= 1000) {
      tps = Math.min(20, ticks * 1000 / elapsed);
      ticks = 0;
      tpsWindowStarted = now;
    }
  }, 50);
  tpsTimer.unref();
  const dropCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const entity of entities.values()) {
      if (entity.kind !== 'item') continue;
      const drop = entity;
      if (now < drop.expiresAt) continue;
      entities.remove(drop.id);
      broadcastToWorld(new BufferWriter().byte(29).byte(1).int(drop.id).build(), drop.world);
    }
  }, 10_000);
  dropCleanupTimer.unref();

  return {
    server,
    listen() {
      logger.info('[init] Loading moderation data');
      return moderationReady.then((moderation) => {
        moderationStore = moderation;
        logger.info('[init] Moderation data ready; binding TCP listener');
        return new Promise<AddressInfo>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('TCP server did not bind to an IP address'));
            return;
          }
          logger.info(`NeoLegacy server listening on ${address.address}:${address.port}`);
          events.emit('serverStarted', { host: address.address, port: address.port });
          resolve(address);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
        });
      });
    },
    async close() {
      events.emit('serverStopping', {});
      scheduler.close();
      clearInterval(tpsTimer);
      clearInterval(dropCleanupTimer);
      for (const connection of connections) connection.socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await pluginManager.disable();
      await Promise.all(worlds.all().map((world) => world.save()));
    },
    playerDeath(username, reason) {
      emitPlayerDeath(username, reason);
    },
  };
}

function canReach(player: SavedPlayer, block: { x: number; y: number; z: number }): boolean {
  const dx = player.x - (block.x + 0.5);
  const dy = player.y + 1.62 - (block.y + 0.5);
  const dz = player.z - (block.z + 0.5);
  return dx * dx + dy * dy + dz * dz <= MAX_BLOCK_REACH * MAX_BLOCK_REACH;
}

function validBlockPosition(position: { x: number; y: number; z: number }): boolean {
  return (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    Number.isInteger(position.z) &&
    position.y >= 0 &&
    position.y < WORLD_HEIGHT &&
    Math.abs(position.x) < MAX_WORLD_COORDINATE &&
    Math.abs(position.z) < MAX_WORLD_COORDINATE
  );
}

function faceOffset(face: number): { x: number; y: number; z: number } | undefined {
  switch (face) {
    case 0: return { x: 0, y: -1, z: 0 };
    case 1: return { x: 0, y: 1, z: 0 };
    case 2: return { x: 0, y: 0, z: -1 };
    case 3: return { x: 0, y: 0, z: 1 };
    case 4: return { x: -1, y: 0, z: 0 };
    case 5: return { x: 1, y: 0, z: 0 };
    default: return undefined;
  }
}

function sameBlock(
  left: { x: number; y: number; z: number } | undefined,
  right: { x: number; y: number; z: number } | undefined,
): boolean {
  return !!left && !!right && left.x === right.x && left.y === right.y && left.z === right.z;
}

function int32Bytes(value: number): number[] {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeInt32BE(value);
  return [...buffer];
}

function resolveWorlds(options: ServerOptions): WorldManager {
  if (options.worlds) return options.worlds;
  if (options.world) return new WorldManager([options.world]);
  throw new Error('Provide either a world or a world manager');
}

function gameModeId(gameMode: GameMode): 0 | 1 | 2 {
  switch (gameMode) {
    case 'survival': return 0;
    case 'creative': return 1;
    case 'adventure': return 2;
    default: throw new Error(`Unsupported game mode: ${gameMode}`);
  }
}

function gameModeName(gameMode: 0 | 1 | 2): PluginGameMode {
  switch (gameMode) {
    case 0: return 'survival';
    case 1: return 'creative';
    case 2: return 'adventure';
  }
}

function parseGameModeArgument(value: string | undefined): 0 | 1 | 2 {
  switch (value?.toLowerCase()) {
    case 'survival':
    case '0':
      return 0;
    case 'creative':
    case '1':
      return 1;
    case 'adventure':
    case '2':
      return 2;
    default:
      throw new Error('Usage: /gamemode <survival|creative|adventure> [player]');
  }
}

function framed(packet: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(packet.length);
  return Buffer.concat([header, packet]);
}

function blockPosition(packet: ClientPacket): { x: number; y: number; z: number } | undefined {
  if (
    packet.blockX === undefined ||
    packet.blockY === undefined ||
    packet.blockZ === undefined ||
    !Number.isInteger(packet.blockX) ||
    !Number.isInteger(packet.blockY) ||
    !Number.isInteger(packet.blockZ)
  ) return undefined;
  return { x: packet.blockX, y: packet.blockY, z: packet.blockZ };
}

function isValidUsername(name: string): boolean {
  return /^[\p{L}\p{N}_ .-]{1,16}$/u.test(name);
}

function xuidFromUsername(username: string): bigint {
  return createHash('sha256').update(normalizeUsername(username), 'utf8').digest().readBigUInt64BE(0) & 0x7fffffffffffffffn;
}

function freezeClientPacket(packet: ClientPacket): Readonly<ClientPacket> {
  const copy: ClientPacket = {
    ...packet,
    position: packet.position ? Object.freeze({ ...packet.position }) : undefined,
    rotation: packet.rotation ? Object.freeze({ ...packet.rotation }) : undefined,
    item: packet.item ? Object.freeze({ ...packet.item }) : packet.item,
    customPayload: packet.customPayload
      ? Object.freeze({ channel: packet.customPayload.channel, data: Buffer.from(packet.customPayload.data) })
      : undefined,
  };
  return Object.freeze(copy);
}
