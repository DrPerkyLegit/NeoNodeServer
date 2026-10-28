import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import test from 'node:test';
import { BufferReader } from '../main/network/buffers/BufferReader';
import { createLegacyPacketRegistry } from '../main/network/LegacyPacketRegistry';
import { LegacyServerPacketHandler } from '../main/network/LegacyServerPacketHandler';
import { IncompletePacketError } from '../main/network/errors/IncompletePacketError';
import { PacketRegistry } from '../main/network/PacketRegistry';
import { LEGACY_NETCODE_VERSION, LEGACY_PROTOCOL_VERSION } from '../main/network/ProtocolConstants';
import { TcpGameServer } from '../main/network/TcpGameServer';
import { KeepAlivePacket } from '../main/network/packets/KeepAlivePacket';
import { GamePacket } from '../main/network/packets/GamePacket';
import { LoginPacket } from '../main/network/packets/LoginPacket';
import { ChatPacket } from '../main/network/packets/ChatPacket';
import { MovePlayerPacket } from '../main/network/packets/MovePlayerPacket';
import { PreLoginPacket } from '../main/network/packets/PreLoginPacket';
import { PlayerAction, PlayerActionPacket } from '../main/network/packets/PlayerActionPacket';
import { SetCarriedItemPacket } from '../main/network/packets/SetCarriedItemPacket';
import { TileUpdatePacket } from '../main/network/packets/TileUpdatePacket';
import { UseItemPacket } from '../main/network/packets/UseItemPacket';
import { ItemStack } from '../main/items/ItemStack';
import { ItemEntity } from '../main/entities/ItemEntity';
import { PlayerInfoPacket } from '../main/network/packets/PlayerInfoPacket';
import { AddPlayerPacket } from '../main/network/packets/AddPlayerPacket';
import { TeleportEntityPacket } from '../main/network/packets/TeleportEntityPacket';
import { RemoveEntitiesPacket } from '../main/network/packets/RemoveEntitiesPacket';
import { TakeItemEntityPacket } from '../main/network/packets/TakeItemEntityPacket';
import { AnimatePacket } from '../main/network/packets/AnimatePacket';
import { ContainerClosePacket } from '../main/network/packets/ContainerClosePacket';
import { ContainerClickPacket } from '../main/network/packets/ContainerClickPacket';
import { ContainerAckPacket } from '../main/network/packets/ContainerAckPacket';
import { DisconnectPacket } from '../main/network/packets/DisconnectPacket';
import { ContainerSetSlotPacket } from '../main/network/packets/ContainerSetSlotPacket';
import { ServerSettingsChangedPacket } from '../main/network/packets/ServerSettingsChangedPacket';
import { WorldServer } from '../main/server/WorldServer';

const registry = new PacketRegistry()
  .register('KeepAlive', () => new KeepAlivePacket())
  .register('Login', () => new LoginPacket())
  .register('PreLogin', () => new PreLoginPacket())
  .register('SetCarriedItem', () => new SetCarriedItemPacket());

test('pre-login uses the separate 571 netcode version and round-trips its packet body', () => {
  const request = PreLoginPacket.response({
    netcodeVersion: LEGACY_NETCODE_VERSION,
    loginKey: 'TestPlayer',
    friendsOnlyBits: 0,
    ugcPlayersVersion: 0,
    uniqueSaveName: Buffer.alloc(14),
    serverSettings: 0,
    hostIndex: 0,
    texturePackId: 0,
  });

  test('pre-login decode errors report a non-sensitive header prefix for diagnosing stream alignment', () => {
    const invalidPreLogin = Buffer.from([2, 0x02, 0x3b, 0x00, 0x21]);
    assert.throws(
      () => registry.decode(invalidPreLogin),
      /packet "PreLogin".*header=02023b0021.*Protocol string exceeds 32/,
    );
  });

  const decoded = registry.decode(request.encode());
  assert.equal(decoded.packet.getName(), 'PreLogin');
  assert.equal(decoded.bytesRead, request.encode().length);
  assert.ok(decoded.packet instanceof PreLoginPacket);
  assert.equal(decoded.packet.netcodeVersion, 571);
  assert.equal(decoded.packet.loginKey, 'TestPlayer');
});

test('login uses protocol 79 and server responses do not forward client XUIDs', () => {
  const request = new LoginPacket();
  request.clientVersion = LEGACY_PROTOCOL_VERSION;
  request.username = 'TestPlayer';
  request.levelType = 'flat';
  request.seed = 123n;

  const decoded = registry.decode(request.encode());
  assert.ok(decoded.packet instanceof LoginPacket);
  assert.equal(decoded.packet.clientVersion, 79);
  assert.equal(decoded.packet.username, 'TestPlayer');
  assert.equal(decoded.packet.xzSize, 320);
  assert.equal(decoded.packet.hellScale, 8);
  assert.equal(decoded.bytesRead, request.encode().length);

  const response = new LoginPacket();
  response.clientVersion = 42;
  response.username = 'TestPlayer';
  response.levelType = 'flat';
  response.maxPlayers = 20;
  const reader = new BufferReader(response.encode());
  reader.readByte();
  reader.readInt();
  reader.readStringUTF16();
  reader.readStringUTF16();
  reader.readLong();
  reader.readInt();
  reader.readByte();
  reader.readByte();
  reader.readByte();
  assert.equal(reader.readLong(), 0n);
  assert.equal(reader.readLong(), 0n);
});

test('tile update packets use the large-world legacy wire format', () => {
  const registryWithTile = new PacketRegistry().register('TileUpdate', () => new TileUpdatePacket());
  const packet = new TileUpdatePacket(-23, 255, 17, 0x1234, 3, 2);
  const encoded = packet.encode();
  assert.equal(encoded.length, 13);
  assert.equal(encoded[0], 53);
  assert.equal(encoded.readInt32BE(1), -23);
  assert.equal(encoded.readUInt8(5), 255);
  assert.equal(encoded.readInt32BE(6), 17);
  assert.equal(encoded.readUInt16BE(10), 0x1234);
  assert.equal(encoded.readUInt8(12), 0x23);
  const decoded = registryWithTile.decode(encoded);

  assert.ok(decoded.packet instanceof TileUpdatePacket);
  assert.equal(decoded.packet.x, -23);
  assert.equal(decoded.packet.y, 255);
  assert.equal(decoded.packet.z, 17);
  assert.equal(decoded.packet.blockId, 0x1234);
  assert.equal(decoded.packet.data, 3);
  assert.equal(decoded.packet.dimension, 2);
});

test('legacy registry consumes known animate and player-command packet layouts', () => {
  const animate = createLegacyPacketRegistry().decode(Buffer.from([18, 0, 0, 0, 1, 2]));
  assert.equal(animate.packet.getName(), 'Animate');
  assert.equal(animate.bytesRead, 6);

  const command = createLegacyPacketRegistry().decode(Buffer.from([19, 0, 0, 0, 1, 4, 0, 0, 0, 0]));
  assert.equal(command.packet.getName(), 'PlayerCommand');
  assert.equal(command.bytesRead, 10);

  const registryWithUiPackets = createLegacyPacketRegistry();
  const close = registryWithUiPackets.decode(Buffer.from([101, 0]));
  assert.ok(close.packet instanceof ContainerClosePacket);
  assert.equal(close.bytesRead, 2);

  const clickPacket = new ContainerClickPacket();
  clickPacket.containerId = 0;
  clickPacket.slot = 9;
  clickPacket.button = 0;
  clickPacket.transactionId = 17;
  clickPacket.clickType = 0;
  const decodedClick = registryWithUiPackets.decode(clickPacket.encode());
  assert.ok(decodedClick.packet instanceof ContainerClickPacket);
  assert.equal(decodedClick.bytesRead, clickPacket.encode().length);
  assert.equal(decodedClick.packet.transactionId, 17);

  const disconnect = registryWithUiPackets.decode(new DisconnectPacket(1).encode());
  assert.ok(disconnect.packet instanceof DisconnectPacket);
  assert.equal(disconnect.packet.reason, 1);
  assert.equal(disconnect.bytesRead, 5);
});

test('ServerSettingsChanged encodes host gamertag visibility with the legacy layout', () => {
  const packet = new ServerSettingsChangedPacket(ServerSettingsChangedPacket.HOST_OPTIONS, 1);
  const encoded = packet.encode();
  assert.deepEqual(encoded, Buffer.from([153, 1, 0, 0, 0, 1]));

  const decoded = createLegacyPacketRegistry().decode(encoded);
  assert.ok(decoded.packet instanceof ServerSettingsChangedPacket);
  assert.equal(decoded.packet.action, ServerSettingsChangedPacket.HOST_OPTIONS);
  assert.equal(decoded.packet.data, 1);
});

test('UseItem accepts a zero-count item as an empty held stack', () => {
  const packet = Buffer.alloc(21);
  packet.writeUInt8(15, 0);
  packet.writeInt32BE(0, 1);
  packet.writeUInt8(3, 5);
  packet.writeInt32BE(0, 6);
  packet.writeUInt8(1, 10);
  packet.writeInt16BE(3, 11);
  packet.writeInt8(0, 13);
  packet.writeInt16BE(0, 14);
  packet.writeInt16BE(-1, 16);

  const decoded = createLegacyPacketRegistry().decode(packet);
  assert.ok(decoded.packet instanceof UseItemPacket);
  assert.equal(decoded.packet.item, undefined);
  assert.equal(decoded.bytesRead, packet.length);
});

test('outgoing multiplayer packets preserve the legacy player and entity layouts', () => {
  const outgoingRegistry = new PacketRegistry()
    .register('PlayerInfo', () => new PlayerInfoPacket())
    .register('AddPlayer', () => new AddPlayerPacket())
    .register('TeleportEntity', () => new TeleportEntityPacket())
    .register('RemoveEntities', () => new RemoveEntitiesPacket())
    .register('TakeItemEntity', () => new TakeItemEntityPacket());
  const playerInfo = new PlayerInfoPacket(4, 0, (1 << 11) | (1 << 12), 12);
  const decodedInfo = outgoingRegistry.decode(playerInfo.encode());
  assert.ok(decodedInfo.packet instanceof PlayerInfoPacket);
  assert.equal(decodedInfo.packet.smallId, 4);
  assert.equal(decodedInfo.packet.privileges, (1 << 11) | (1 << 12));
  assert.equal(decodedInfo.packet.entityId, 12);

  const addPlayer = new AddPlayerPacket(12, 'Other', 1.5, 4, -2, 90, 0, 0, 0x1800);
  const encodedAddPlayer = addPlayer.encode();
  const decodedPlayer = outgoingRegistry.decode(encodedAddPlayer);
  assert.ok(decodedPlayer.packet instanceof AddPlayerPacket);
  assert.equal(decodedPlayer.packet.username, 'Other');
  assert.equal(decodedPlayer.packet.x, 1.5);
  assert.equal(decodedPlayer.packet.z, -2);
  assert.equal(decodedPlayer.packet.privileges, 0x1800);
  const metadataOffset = encodedAddPlayer.length - 34;
  assert.deepEqual(
    encodedAddPlayer.subarray(metadataOffset),
    Buffer.from([
      0x00, 0,
      0x21, 0x01, 0x2c,
      0x05, 0,
      0x66, 0x41, 0xa0, 0x00, 0x00,
      0x47, 0, 0, 0, 0,
      0x08, 0,
      0x09, 0,
      0x10, 0,
      0x71, 0, 0, 0, 0,
      0x52, 0, 0, 0, 0,
      0x7f,
    ]),
  );

  const teleport = new TeleportEntityPacket(12, 1.5, 4, -2, 90, 0);
  const decodedTeleport = outgoingRegistry.decode(teleport.encode());
  assert.ok(decodedTeleport.packet instanceof TeleportEntityPacket);
  assert.equal(decodedTeleport.packet.x, 1.5);
  assert.equal(decodedTeleport.packet.z, -2);

  const decodedRemoval = outgoingRegistry.decode(new RemoveEntitiesPacket([12]).encode());
  assert.deepEqual((decodedRemoval.packet as RemoveEntitiesPacket).entityIds, [12]);
  const decodedTake = outgoingRegistry.decode(new TakeItemEntityPacket(21, 12).encode());
  assert.equal((decodedTake.packet as TakeItemEntityPacket).itemEntityId, 21);
  assert.equal((decodedTake.packet as TakeItemEntityPacket).playerEntityId, 12);
});

test('legacy TCP handshake validates both versions and creates a player session', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neo-legacy-handshake-'));
  let gameServer: TcpGameServer | undefined;
  let socket: Socket | undefined;
  let secondSocket: Socket | undefined;
  try {
    const worldServer = await WorldServer.load(path.join(directory, 'server.properties'));
    const packetRegistry = createLegacyPacketRegistry();
    const handler = new LegacyServerPacketHandler(worldServer);
    gameServer = new TcpGameServer(packetRegistry, handler);
    const address = await gameServer.listen('127.0.0.1', 0);
    socket = connect({ host: address.address, port: address.port });
    await once(socket, 'connect');
    const [smallId] = await once(socket, 'data') as [Buffer];
    assert.equal(smallId.length, 1);
    assert.equal(smallId[0], 4);

    const preLoginResponse = readNextPacket(socket, packetRegistry);
    socket.write(framePacket(legacyPreLoginFixture('HandshakeUser')));
    const response = await preLoginResponse;
    assert.ok(response instanceof PreLoginPacket);
    assert.equal(response.loginKey, '-');
    assert.equal(response.netcodeVersion, 571);

    const loginResponse = readNextPacket(socket, packetRegistry);
    const observedGamertags = observePacket(
      socket,
      new ServerSettingsChangedPacket(ServerSettingsChangedPacket.HOST_OPTIONS, 1),
    );
    const login = new LoginPacket();
    login.clientVersion = LEGACY_PROTOCOL_VERSION;
    login.username = 'HandshakeUser';
    login.levelType = 'flat';
    login.seed = worldServer.properties.seed;
    socket.write(framePacket(login.encode()));
    const acceptedLogin = await loginResponse;
    await observedGamertags;
    assert.ok(acceptedLogin instanceof LoginPacket);
    assert.equal(acceptedLogin.username, '');
    assert.equal(acceptedLogin.clientVersion, 1);
    assert.ok(acceptedLogin.clientVersion > 0);
    assert.equal(acceptedLogin.uiGamePrivileges & (1 << 11), 1 << 11);
    assert.equal(acceptedLogin.uiGamePrivileges & (1 << 12), 1 << 12);
    assert.equal(handler.players.values().length, 1);

    const player = handler.players.getByName('HandshakeUser');
    assert.ok(player);
    const dirt = worldServer.items.get(3);
    assert.ok(dirt);
    player.inventory.set(0, new ItemStack(dirt, 2));
    player.selectedSlot = 0;
    const movement = new MovePlayerPacket('position');
    movement.x = 1;
    movement.y = 4;
    movement.stance = 5.62;
    movement.z = 0.5;
    movement.onGround = true;
    socket.write(framePacket(movement.encode()));
    await waitFor(() => player.x === 1);
    handler.flushMovementUpdates();

    const chat = ChatPacket.message('hello world');
    socket.write(framePacket(chat.encode()));
    const placeBlock = new UseItemPacket();
    placeBlock.x = 1;
    placeBlock.y = 3;
    placeBlock.z = 0;
    placeBlock.face = 1;
    placeBlock.item = { itemId: 3, count: 2, damage: 0 };
    placeBlock.clickX = 0.5;
    placeBlock.clickY = 1;
    placeBlock.clickZ = 0.5;
    socket.write(framePacket(placeBlock.encode()));
    await waitFor(() => worldServer.worlds.get('defaultWorld')?.getBlock(1, 4, 0) === 3);
    assert.equal(player.inventory.get(0)?.count, 1);

    const breakBlock = new PlayerActionPacket();
    breakBlock.action = PlayerAction.StopDestroyBlock;
    breakBlock.x = 0;
    breakBlock.y = 3;
    breakBlock.z = 0;
    socket.write(framePacket(breakBlock.encode()));
    await waitFor(() => worldServer.worlds.get('defaultWorld')?.getBlock(0, 3, 0) === 0);
    assert.equal(player.x, 1);
    assert.equal(player.inventory.get(0)?.count, 1);
    assert.ok([...worldServer.worlds.get('defaultWorld')!.entities.values()]
      .some((entity) => entity instanceof ItemEntity));
    assert.equal(handler.players.values().length, 1);

    const secondEntityId = Math.max(...worldServer.entities.values().map((entity) => entity.id)) + 1;
    const observedInfo = observePacket(socket, new PlayerInfoPacket(5, 1, 0x1800, secondEntityId));
    const observedAddPlayer = observePacket(
      socket,
      new AddPlayerPacket(secondEntityId, 'SecondPlayer', 0.5, 4, 0.5, 0, 0, 1, 0x1800),
    );
    const observedJoinChat = observeChat(socket, 'SecondPlayer joined the game');
    secondSocket = connect({ host: address.address, port: address.port });
    await once(secondSocket, 'connect');
    const [secondSmallId] = await once(secondSocket, 'data') as [Buffer];
    assert.equal(secondSmallId[0], 5);
    const secondPreLoginResponse = readNextPacket(secondSocket, packetRegistry);
    secondSocket.write(framePacket(legacyPreLoginFixture('SecondPlayer')));
    assert.ok(await secondPreLoginResponse instanceof PreLoginPacket);
    const secondLoginResponse = readNextPacket(secondSocket, packetRegistry);
    const secondLogin = new LoginPacket();
    secondLogin.clientVersion = LEGACY_PROTOCOL_VERSION;
    secondLogin.username = 'SecondPlayer';
    secondLogin.levelType = 'flat';
    secondLogin.seed = worldServer.properties.seed;
    secondSocket.write(framePacket(secondLogin.encode()));
    assert.ok(await secondLoginResponse instanceof LoginPacket);
    await Promise.all([observedInfo, observedAddPlayer, observedJoinChat]);

    const animation = new AnimatePacket();
    animation.entityId = secondEntityId;
    animation.action = 3;
    const observedAnimation = observePacket(socket, animation);
    secondSocket.write(framePacket(animation.encode()));
    await observedAnimation;

    const secondMovement = new MovePlayerPacket('position');
    secondMovement.x = 1.5;
    secondMovement.y = 4;
    secondMovement.stance = 5.62;
    secondMovement.z = 0.5;
    secondMovement.onGround = true;
    const secondPlayer = handler.players.getByName('SecondPlayer');
    assert.ok(secondPlayer);
    const observedMovement = observePacket(
      socket,
      new TeleportEntityPacket(secondEntityId, 1.5, 4, 0.5, 0, 0),
    );
    secondSocket.write(framePacket(secondMovement.encode()));
    await waitFor(() => secondPlayer.x === 1.5);
    handler.flushMovementUpdates();
    await observedMovement;
    assert.equal(handler.players.values().length, 2);

    const world = worldServer.worlds.get('defaultWorld');
    assert.ok(world);
    const pickupItem = worldServer.items.get(3);
    assert.ok(pickupItem);
    const droppedItem = worldServer.entities.add(new ItemEntity(
      worldServer.entities.allocateId(),
      new ItemStack(pickupItem, 1),
      secondPlayer.x,
      secondPlayer.y,
      secondPlayer.z,
    ));
    droppedItem.pickupDelayTicks = 0;
    world.addEntity(droppedItem);
    const observedHotbarUpdate = observePacket(
      secondSocket,
      new ContainerSetSlotPacket(0, 36, new ItemStack(pickupItem, 1)),
    );
    secondSocket.write(framePacket(secondMovement.encode()));
    await observedHotbarUpdate;
    assert.equal(secondPlayer.inventory.get(0)?.item.id, pickupItem.id);

    const dirtStack = worldServer.items.get(3);
    assert.ok(dirtStack);
    secondPlayer.inventory.set(0, new ItemStack(dirtStack, 4));
    const observedClickAck = observePacket(secondSocket, new ContainerAckPacket(0, 7, true));
    const click = new ContainerClickPacket();
    click.containerId = 0;
    click.slot = 36;
    click.transactionId = 7;
    click.clickType = 0;
    secondSocket.write(framePacket(click.encode()));
    await observedClickAck;
    await waitFor(() => secondPlayer.carriedItem?.count === 4);
    assert.equal(secondPlayer.inventory.get(0), undefined);

    const observedTps = observeChat(secondSocket, /^TPS: \d+\.\d{2}$/);
    secondSocket.write(framePacket(ChatPacket.message('/tps').encode()));
    await observedTps;

    const observedLeaveChat = observeChat(socket, 'SecondPlayer left the game');
    const disconnect = new DisconnectPacket(1);
    secondSocket.write(framePacket(disconnect.encode()));
    await observedLeaveChat;
    await waitFor(() => handler.players.values().length === 1);
  } finally {
    socket?.destroy();
    secondSocket?.destroy();
    await gameServer?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for packet handler');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readNextPacket(socket: Socket, packetRegistry: PacketRegistry): Promise<GamePacket> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const onError = (error: Error): void => {
      socket.off('data', onData);
      reject(error);
    };
    const onData = (data: Buffer): void => {
      pending = Buffer.concat([pending, data]);
      if (pending.length < 4) return;
      const packetLength = pending.readUInt32BE(0);
      if (packetLength === 0 || packetLength > 4 * 1024 * 1024) {
        socket.off('data', onData);
        socket.off('error', onError);
        reject(new Error(`Invalid frame length ${packetLength}`));
        return;
      }
      if (pending.length < packetLength + 4) return;
      try {
        const decoded = packetRegistry.decode(pending.subarray(4, packetLength + 4));
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(decoded.packet);
      } catch (error) {
        if (!(error instanceof IncompletePacketError)) {
          socket.off('data', onData);
          socket.off('error', onError);
          reject(error);
        }
      }
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function framePacket(packet: Buffer): Buffer {
  const frame = Buffer.alloc(4 + packet.length);
  frame.writeUInt32BE(packet.length);
  packet.copy(frame, 4);
  return frame;
}

function observePacket(socket: Socket, packet: GamePacket): Promise<void> {
  const expectedPacket = packet.encode();
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for packet ${packet.getName()}`)), 2_000);
    const onData = (data: Buffer): void => {
      received = Buffer.concat([received, data]);
      while (received.length >= 4) {
        const frameLength = received.readUInt32BE(0);
        if (received.length < frameLength + 4) return;
        const frame = received.subarray(4, frameLength + 4);
        if (frame.includes(expectedPacket)) {
          finish();
          return;
        }
        received = received.subarray(frameLength + 4);
      }
    };
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      socket.off('data', onData);
      if (error) reject(error);
      else resolve();
    };
    socket.on('data', onData);
  });
}

function observeChat(socket: Socket, expected: string | RegExp): Promise<void> {
  let pending = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Timed out waiting for expected chat message')), 2_000);
    const onData = (data: Buffer): void => {
      pending = Buffer.concat([pending, data]);
      try {
        while (pending.length >= 4) {
          const frameLength = pending.readUInt32BE(0);
          if (pending.length < frameLength + 4) return;
          const packetData = pending.subarray(4, frameLength + 4);
          pending = pending.subarray(frameLength + 4);
          if (packetData[0] !== 3) continue;
          const decoded = createLegacyPacketRegistry().decode(packetData);
          if (!(decoded.packet instanceof ChatPacket)) continue;
          const message = decoded.packet.strings[0] ?? '';
          if (typeof expected === 'string' ? message === expected : expected.test(message)) {
            finish();
            return;
          }
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      socket.off('data', onData);
      if (error) reject(error);
      else resolve();
    };
    socket.on('data', onData);
  });
}

function legacyPreLoginFixture(username: string): Buffer {
  const usernameBytes = Buffer.alloc(username.length * 2);
  for (let index = 0; index < username.length; index += 1) {
    usernameBytes.writeUInt16BE(username.charCodeAt(index), index * 2);
  }
  return Buffer.concat([
    Buffer.from([2, 0x02, 0x3b, (username.length >> 8) & 0xff, username.length & 0xff]),
    usernameBytes,
    Buffer.from([0]),
    Buffer.alloc(4),
    Buffer.from([0]),
    Buffer.alloc(14),
    Buffer.alloc(4),
    Buffer.from([0]),
    Buffer.alloc(4),
  ]);
}
