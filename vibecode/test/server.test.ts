import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net, { type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BufferReader, BufferWriter } from '../src/binary';
import { buildInventoryPacket, buildPlayerPositionPacket } from '../src/protocol';
import { WorldManager } from '../src/world/manager';
import { createFlatChunk } from '../src/world/chunk';
import { createServer } from '../src/server/server';
import { World } from '../src/world/world';
import type { EntityRegistryView } from '../src/server/entities';
import type { PluginApi, ServerPlugin } from '../src/server/plugins';

interface SocketReader {
  readByte(): Promise<number>;
  readFrame(): Promise<Buffer>;
}

function frame(payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function preLoginPacket(): Buffer {
  return new BufferWriter()
    .byte(2)
    .short(571)
    .utf('Builder')
    .byte(0)
    .int(0)
    .byte(0)
    .bytes(Buffer.alloc(14))
    .int(0)
    .byte(0)
    .int(0)
    .build();
}

function loginPacket(name: string, offlineXuid = 0n, onlineXuid = 0n): Buffer {
  return new BufferWriter()
    .byte(1)
    .int(79)
    .utf(name)
    .utf('')
    .long(0n)
    .int(0)
    .byte(0)
    .byte(0)
    .byte(8)
    .long(offlineXuid)
    .long(onlineXuid)
    .bool(false)
    .int(0)
    .byte(1)
    .int(0)
    .byte(0)
    .int(0)
    .int(0)
    .bool(false)
    .bool(false)
    .int(0)
    .short(320)
    .byte(8)
    .build();
}

function makeReader(socket: Socket): SocketReader {
  let buffer = Buffer.alloc(0);
  const waiters: Array<{
    length: number;
    resolve: (value: Buffer) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
    while (waiters.length && buffer.length >= waiters[0].length) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timeout);
      const value = buffer.subarray(0, waiter.length);
      buffer = buffer.subarray(waiter.length);
      waiter.resolve(value);
    }
  });
  socket.on('error', (error) => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  });
  const readBytes = (length: number): Promise<Buffer> => {
    if (buffer.length >= length) {
      const value = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      return Promise.resolve(value);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        length,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('Timed out waiting for a TCP frame'));
        }, 3000),
      };
      waiters.push(waiter);
    });
  };
  return {
    readByte: async () => (await readBytes(1))[0],
    readFrame: async () => {
      const length = (await readBytes(4)).readUInt32BE(0);
      return readBytes(length);
    },
  };
}

test('outgoing player positions send feet Y before stance Y', () => {
  const packet = buildPlayerPositionPacket({
    name: 'Tester',
    x: 0.5,
    y: 4,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    inventory: [],
  });
  const reader = new BufferReader(packet.subarray(1));
  assert.equal(reader.double(), 0.5);
  assert.equal(reader.double(), 4);
  assert.equal(reader.double(), 5.62);
  assert.equal(reader.double(), 0.5);
});

test('inventory contents map storage slots to client menu and hotbar slots', () => {
  const inventory: Array<{ id: number; count: number; damage: number } | null> = Array.from({ length: 36 }, () => null);
  inventory[0] = { id: 1, count: 10, damage: 0 };
  inventory[5] = { id: 3, count: 4, damage: 0 };
  inventory[9] = { id: 4, count: 2, damage: 0 };
  const packet = buildInventoryPacket(inventory);
  const reader = new BufferReader(packet.subarray(1));
  assert.equal(reader.byte(), 0);
  assert.equal(reader.short(), 45);
  for (let slot = 0; slot < 45; slot += 1) {
    const id = reader.short();
    if (slot === 36) {
      assert.equal(id, 1);
      assert.equal(reader.byte(), 10);
    } else if (slot === 41) {
      assert.equal(id, 3);
      assert.equal(reader.byte(), 4);
    } else if (slot === 9) {
      assert.equal(id, 4);
      assert.equal(reader.byte(), 2);
    } else {
      assert.equal(id, -1);
      continue;
    }
    reader.short();
    assert.equal(reader.short(), -1);
  }
  assert.equal(reader.offset, packet.length - 1);
});

async function connectTo(
  port: number,
  name: string,
  offlineXuid = 0n,
  onlineXuid = 0n,
): Promise<{ socket: Socket; reader: SocketReader; privileges: number }> {
  const socket = net.createConnection(port, '127.0.0.1');
  const reader = makeReader(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  assert.ok((await reader.readByte()) >= 4);
  socket.write(frame(preLoginPacket()));
  const preLoginResponse = await reader.readFrame();
  assert.equal(preLoginResponse[0], 2);
  assert.equal(preLoginResponse.readInt16BE(1), 571);
  socket.write(frame(loginPacket(name, offlineXuid, onlineXuid)));
  const initialState = await reader.readFrame();
  assert.equal(initialState[0], 1);
  assert.equal(initialState.readInt32BE(1), 79);
  const loginReader = new BufferReader(initialState.subarray(5));
  assert.equal(loginReader.utf(16), '');
  assert.equal(loginReader.utf(16), 'flat');
  loginReader.long();
  loginReader.int();
  loginReader.byte();
  loginReader.byte();
  loginReader.byte();
  loginReader.long();
  loginReader.long();
  loginReader.bool();
  loginReader.int();
  loginReader.byte();
  loginReader.int();
  loginReader.byte();
  loginReader.int();
  loginReader.int();
  loginReader.bool();
  loginReader.bool();
  const privileges = loginReader.int();
  assert.equal(privileges & (1 << 11), 1 << 11);
  assert.equal(privileges & (1 << 12), 1 << 12);
  for (let i = 0; i < 81; i += 1) {
    const chunk = await reader.readFrame();
    assert.equal(chunk[0], 50);
    assert.equal(chunk[10], 51);
  }
  const creative = await reader.readFrame();
  const recipes = await reader.readFrame();
  assert.equal(creative[0], 250);
  assert.equal(recipes[0], 250);
  assert.equal(customPayloadChannel(creative), 'neo|UpdCReg');
  assert.equal(customPayloadChannel(recipes), 'neo|UpdRReg');
  return { socket, reader, privileges };
}

function customPayloadChannel(packet: Buffer): string {
  const reader = new BufferReader(packet.subarray(1));
  const channel = reader.utf(20);
  const length = reader.short();
  assert.equal(reader.bytes(length).length, length);
  assert.equal(reader.offset, packet.length - 1);
  return channel;
}

function packetId(packet: Buffer): number {
  return packet[0];
}

function chatText(packet: Buffer): string {
  const reader = new BufferReader(packet.subarray(1));
  reader.short();
  const counts = reader.unsignedShort();
  const stringCount = (counts >> 4) & 0x0f;
  assert.ok(stringCount > 0);
  return reader.utf(258);
}

function addPlayerXuid(packet: Buffer): bigint {
  const reader = new BufferReader(packet.subarray(1));
  reader.int();
  reader.utf(16);
  reader.int();
  reader.int();
  reader.int();
  reader.byte();
  reader.byte();
  reader.byte();
  reader.short();
  const offline = reader.long();
  assert.equal(reader.long(), 0n);
  return offline;
}

test('framed clients join, see each other, break and place blocks, and save world state', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-flat-server-'));
  const world = await World.load({ filePath: join(directory, 'world.slime'), seed: 42n });
  let entities: EntityRegistryView | undefined;
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 4,
    world,
    plugins: [{
      name: 'entity-registry-test',
      onEnable(api) {
        entities = api.server.entities;
      },
    }],
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await instance.listen();
  const sockets: Socket[] = [];
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  const alice = await connectTo(address.port, 'Alice');
  sockets.push(alice.socket);
  assert.equal(packetId(await alice.reader.readFrame()), 3);
  const bob = await connectTo(address.port, 'Bob', 0x123456789abcdef0n, 0x0fedcba987654321n);
  sockets.push(bob.socket);

  assert.equal(packetId(await bob.reader.readFrame()), 201);
  const bobSeesAlice = await bob.reader.readFrame();
  assert.equal(packetId(bobSeesAlice), 20);
  assert.equal(addPlayerXuid(bobSeesAlice), 0n);
  assert.equal(packetId(await bob.reader.readFrame()), 3);
  assert.equal(packetId(await alice.reader.readFrame()), 201);
  const aliceSeesBob = await alice.reader.readFrame();
  assert.equal(packetId(aliceSeesBob), 20);
  assert.equal(addPlayerXuid(aliceSeesBob), 0n);
  assert.equal(packetId(await alice.reader.readFrame()), 3);

  const startBreaking = new BufferWriter().byte(14).byte(0).int(0).byte(3).int(0).byte(1).build();
  const stopBreaking = new BufferWriter().byte(14).byte(2).int(0).byte(3).int(0).byte(1).build();
  alice.socket.write(frame(startBreaking));
  alice.socket.write(frame(stopBreaking));
  const broken = await alice.reader.readFrame();
  assert.equal(packetId(broken), 53);
  assert.equal(broken.readInt16BE(10), 0);
  const droppedEntity = await alice.reader.readFrame();
  assert.equal(packetId(droppedEntity), 23);
  assert.equal(droppedEntity.readInt32BE(6), 16);
  assert.equal(droppedEntity.readInt32BE(10), 112);
  assert.equal(droppedEntity.readInt32BE(14), 16);
  assert.equal(droppedEntity.length, 24);
  const droppedMetadata = await alice.reader.readFrame();
  assert.equal(packetId(droppedMetadata), 40);
  const droppedItemData = new BufferReader(droppedMetadata.subarray(5));
  assert.equal(droppedItemData.byte(), (5 << 5) | 10);
  assert.equal(droppedItemData.short(), 3);
  assert.equal(droppedItemData.byte(), 1);
  assert.equal(droppedItemData.short(), 0);
  assert.equal(droppedItemData.short(), -1);
  assert.equal(droppedItemData.byte(), 127);
  assert.equal(droppedItemData.offset, droppedMetadata.length - 5);
  assert.equal(entities?.inWorld(world).length, 1);
  assert.equal(entities?.inWorld(world)[0].kind, 'item');
  assert.equal(packetId(await bob.reader.readFrame()), 53);
  assert.equal(packetId(await bob.reader.readFrame()), 23);
  assert.equal(packetId(await bob.reader.readFrame()), 40);

  const placeBlock = new BufferWriter()
    .byte(15)
    .int(0)
    .byte(2)
    .int(0)
    .byte(1)
    .short(1)
    .byte(1)
    .short(0)
    .short(-1)
    .byte(8)
    .byte(8)
    .byte(8)
    .build();
  alice.socket.write(frame(placeBlock));
  const placed = await alice.reader.readFrame();
  assert.equal(packetId(placed), 53);
  assert.equal(placed.readInt16BE(10), 1);
  assert.equal(packetId(await alice.reader.readFrame()), 103);
  assert.equal(packetId(await bob.reader.readFrame()), 53);

  const move = new BufferWriter()
    .byte(13)
    .double(1.5)
    .double(5.62)
    .double(4)
    .double(0.5)
    .float(90)
    .float(0)
    .byte(0)
    .build();
  await new Promise((resolve) => setTimeout(resolve, 550));
  alice.socket.write(frame(move));
  assert.equal(packetId(await alice.reader.readFrame()), 22);
  const updatedInventory = await alice.reader.readFrame();
  assert.equal(packetId(updatedInventory), 103);
  assert.equal(updatedInventory[1], 0);
  assert.equal(updatedInventory.readInt16BE(2), 41);
  assert.equal(updatedInventory.readInt16BE(4), 3);
  assert.equal(updatedInventory[6], 1);
  assert.equal(updatedInventory.readInt16BE(7), 0);
  assert.equal(updatedInventory.readInt16BE(9), -1);
  assert.equal(entities?.inWorld(world).length, 0);
  const teleported = await bob.reader.readFrame();
  assert.equal(packetId(teleported), 22);
  assert.equal(packetId(await bob.reader.readFrame()), 34);

  await world.save();
  const saved = await World.load({ filePath: join(directory, 'world.slime') });
  assert.equal(saved.getChunk(0, 0).blocks[3 * 256], 1);
  assert.equal(saved.players.get('alice')?.x, 1.5);
  assert.equal(saved.players.get('alice')?.inventory[0]?.count, 63);
  assert.deepEqual(saved.players.get('alice')?.inventory[5], { id: 3, count: 1, damage: 0 });
});

test('server rejects a malformed login frame without crashing', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-flat-reject-'));
  const world = await World.load({ filePath: join(directory, 'world.slime') });
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 1,
    world,
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await instance.listen();
  const socket = net.createConnection(address.port, '127.0.0.1');
  const reader = makeReader(socket);
  context.after(async () => {
    socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  await reader.readByte();
  socket.write(Buffer.from([0, 0, 0, 0]));
  await new Promise<void>((resolve) => socket.once('close', () => resolve()));
});

test('packet rate limit is configurable and reports the triggering packet count', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-packet-rate-'));
  const world = await World.load({ filePath: join(directory, 'world.slime') });
  const warnings: string[] = [];
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 1,
    maxPacketsPerSecond: 10,
    world,
    logger: { info() {}, warn(message) { warnings.push(message); }, error() {} },
  });
  const address = await instance.listen();
  const client = await connectTo(address.port, 'RateTester');
  context.after(async () => {
    client.socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });

  const burst = Buffer.concat(Array.from({ length: 9 }, () => frame(new BufferWriter().byte(10).byte(0).build())));
  const closed = new Promise<void>((resolve) => client.socket.once('close', () => resolve()));
  client.socket.write(burst);
  await closed;
  assert.ok(warnings.some((warning) => warning.includes('id=10, count=11/10 per second')));
  assert.throws(() => createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 1,
    maxPacketsPerSecond: 0,
    world,
    logger: { info() {}, warn() {}, error() {} },
  }), /maxPacketsPerSecond must be an integer/);
});

test('default packet rate limit allows large joined-client bursts', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-packet-burst-'));
  const world = await World.load({ filePath: join(directory, 'world.slime') });
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 1,
    world,
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await instance.listen();
  const client = await connectTo(address.port, 'BurstTester');
  let closed = false;
  client.socket.once('close', () => { closed = true; });
  context.after(async () => {
    client.socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });

  const packet = frame(new BufferWriter().byte(10).byte(0).build());
  client.socket.write(Buffer.concat(Array.from({ length: 2200 }, () => packet)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(closed, false);
});

test('plugins can cancel block changes, register commands, receive death events, and schedule tasks', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-plugin-server-'));
  const world = await World.load({ name: 'overworld', filePath: join(directory, 'world.slime') });
  let xuid = 0n;
  let blockedPlacements = 0;
  let interceptedPackets = 0;
  let deathReason = '';
  let taskRuns = 0;
  let taskErrors = 0;
  let verbosePacketLogs = 0;
  const plugin: ServerPlugin = {
    name: 'test-plugin',
    onEnable(api) {
      api.blocks.register({ id: 300, name: 'plugin test block', tab: 0 });
      api.events.on('playerJoin', ({ player }) => { xuid = player.xuid; });
      api.events.on('blockPlace', () => {
        blockedPlacements += 1;
        return false;
      });
      api.events.on('playerDeath', ({ reason }) => { deathReason = reason; });
      api.events.on('packet', (event) => {
        if (event.direction === 'incoming' && event.packetId === 10) {
          interceptedPackets += 1;
          event.cancelled = true;
        }
      });
      api.commands.register({
        name: 'plugin-test',
        description: 'Check plugin commands.',
        execute: ({ reply }) => reply('Plugin command ran.'),
      });
      api.scheduler.repeat(() => { taskRuns += 1; }, 1);
      api.scheduler.later(async () => { throw new Error('expected scheduled failure'); }, 1);
    },
  };
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 4,
    world,
    plugins: [plugin],
    verbose: true,
    moderationFile: join(directory, 'moderation.json'),
    logger: {
      info(message) { if (message.includes('[packet:')) verbosePacketLogs += 1; },
      warn() {},
      error(message) { if (message.includes('Scheduled plugin task failed')) taskErrors += 1; },
    },
  });
  const address = await instance.listen();
  const client = await connectTo(address.port, 'PluginUser');
  context.after(async () => {
    client.socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.reader.readFrame();
  assert.notEqual(xuid, 0n);
  assert.equal(xuid, createHashXuid('PluginUser'));

  client.socket.write(frame(new BufferWriter().byte(10).byte(0).build()));
  const placeBlock = new BufferWriter()
    .byte(15)
    .int(0)
    .byte(3)
    .int(0)
    .byte(1)
    .short(1)
    .byte(1)
    .short(0)
    .short(-1)
    .byte(8)
    .byte(8)
    .byte(8)
    .build();
  client.socket.write(frame(placeBlock));
  client.socket.write(frame(new BufferWriter().byte(0).int(99).build()));
  assert.equal(packetId(await client.reader.readFrame()), 0);
  assert.equal(interceptedPackets, 1);
  assert.equal(blockedPlacements, 1);
  assert.equal(world.getChunk(0, 0).blocks[4 * 256], 0);

  client.socket.write(frame(new BufferWriter().byte(3).short(0).short(0x10).utf('/plugin-test').build()));
  assert.match(chatText(await client.reader.readFrame()), /Plugin command ran/);
  client.socket.write(frame(new BufferWriter().byte(3).short(0).short(0x10).utf('/tps').build()));
  assert.match(chatText(await client.reader.readFrame()), /TPS:/);
  instance.playerDeath('PluginUser', 'test-death');
  assert.equal(deathReason, 'test-death');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(taskRuns > 0);
  assert.equal(taskErrors, 1);
  assert.ok(verbosePacketLogs > 0);
});

test('plugins can observe unsupported packets, decline packet IDs, and use expanded server hooks', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-plugin-packets-'));
  const world = await World.load({ name: 'overworld', filePath: join(directory, 'world.slime') });
  let unsupportedData: Buffer | undefined;
  let kickReason = '';
  let actionCount = 0;
  let payloadChannel = '';
  let modeChange = '';
  let started = false;
  let stopping = false;
  let joinedPlayerFound = false;
  let pluginApi: PluginApi | undefined;
  const pluginErrors: string[] = [];
  const plugin: ServerPlugin = {
    name: 'packet-policy-plugin',
    onLoad(api) {
      api.packets.decline([201]);
    },
    onEnable(api) {
      pluginApi = api;
      api.events.on('serverStarted', () => { started = true; });
      api.events.on('serverStopping', () => { stopping = true; });
      api.events.on('playerJoin', ({ player }) => {
        joinedPlayerFound = api.server.getPlayer(player.name)?.name === player.name &&
          api.server.getWorlds().includes(world) &&
          api.server.getTps() > 0;
      });
      api.events.on('playerAction', ({ action }) => {
        if (action !== 'swing') return;
        actionCount += 1;
        return false;
      });
      api.events.on('customPayload', ({ channel }) => { payloadChannel = channel; });
      api.events.on('playerGameModeChange', ({ from, to }) => { modeChange = `${from}:${to}`; });
      api.events.on('playerKick', ({ reason }) => { kickReason = reason; });
      api.events.on('packet', (event) => {
        if (event.direction !== 'incoming' || event.packetId !== 200) return;
        assert.equal(event.unsupported, true);
        assert.equal(event.packet, undefined);
        unsupportedData = Buffer.from(event.data);
      });
    },
  };
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 2,
    world,
    plugins: [plugin],
    logger: { info() {}, warn() {}, error(message) { pluginErrors.push(message); } },
  });
  const address = await instance.listen();
  const client = await connectTo(address.port, 'PacketTester');
  let closed = false;
  context.after(async () => {
    client.socket.destroy();
    if (!closed) await instance.close();
    await rm(directory, { recursive: true, force: true });
  });

  assert.equal(packetId(await client.reader.readFrame()), 3);
  assert.equal(started, true);
  assert.equal(joinedPlayerFound, true);
  assert.ok(pluginApi);
  assert.equal(pluginApi.server.getWorld('overworld'), world);
  assert.equal(pluginApi.server.getWorlds().includes(world), true);
  assert.equal(pluginApi.server.getPlayer('PacketTester')?.name, 'PacketTester');
  assert.ok(pluginApi.server.getTps() > 0);
  assert.equal(await pluginApi.server.saveWorld('overworld'), true);

  client.socket.write(frame(new BufferWriter().byte(200).byte(8).byte(9).build()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(unsupportedData, Buffer.from([200, 8, 9]), pluginErrors.join('\n'));

  client.socket.write(frame(new BufferWriter().byte(10).byte(0).build()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(actionCount, 1);
  client.socket.write(frame(new BufferWriter().byte(250).utf('test:channel').short(2).bytes(Buffer.from([1, 2])).build()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(payloadChannel, 'test:channel');

  assert.equal(pluginApi.server.setGameMode('PacketTester', 'creative'), true);
  assert.equal(modeChange, 'survival:creative');
  assert.equal(packetId(await client.reader.readFrame()), 70);
  assert.equal(packetId(await client.reader.readFrame()), 104);
  assert.equal(packetId(await client.reader.readFrame()), 201);

  client.socket.write(frame(new BufferWriter().byte(201).build()));
  const disconnect = await client.reader.readFrame();
  assert.equal(packetId(disconnect), 255);
  assert.equal(kickReason, 'Packet ID 201 is not allowed');

  await instance.close();
  closed = true;
  assert.equal(stopping, true);
});

test('plugins load in dependency order and can register content in onLoad', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-plugin-order-'));
  const world = await World.load({ name: 'overworld', filePath: join(directory, 'world.slime') });
  const lifecycle: string[] = [];
  const logs: string[] = [];
  let dependencyLoaded = false;
  const dependentPlugin: ServerPlugin = {
    name: 'dependent-plugin',
    dependsOn: ['BASE-PLUGIN'],
    onLoad(api) {
      assert.equal(dependencyLoaded, true);
      api.items.register({ id: 32001, name: 'dependent item', tab: 15 });
      lifecycle.push('dependent:load');
    },
    onEnable() {
      lifecycle.push('dependent:enable');
    },
    onDisable() {
      lifecycle.push('dependent:disable');
    },
  };
  const basePlugin: ServerPlugin = {
    name: 'base-plugin',
    onLoad(api) {
      api.items.register({ id: 32000, name: 'base item', tab: 15 });
      lifecycle.push('base:load');
    },
    onEnable() {
      dependencyLoaded = true;
      lifecycle.push('base:enable');
    },
    onDisable() {
      lifecycle.push('base:disable');
    },
  };
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 2,
    world,
    plugins: [dependentPlugin, basePlugin],
    logger: {
      info(message) { logs.push(message); },
      warn() {},
      error() {},
    },
  });
  let closed = false;
  context.after(async () => {
    if (!closed) await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  const address = await instance.listen();
  assert.ok(address.port > 0);
  assert.deepEqual(lifecycle, [
    'base:load',
    'base:enable',
    'dependent:load',
    'dependent:enable',
  ]);
  assert.ok(logs.indexOf('[init] Initializing block, item, recipe, event, and command registries') < logs.indexOf('[plugin] Loading plugin base-plugin'));
  assert.ok(logs.indexOf('[plugin] Loaded plugin dependent-plugin') < logs.indexOf('[init] Validating and sealing registries'));
  await instance.close();
  closed = true;
  assert.deepEqual(lifecycle.slice(-2), ['dependent:disable', 'base:disable']);
  assert.throws(() => createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 2,
    world,
    plugins: [{ name: 'missing-dependency', dependsOn: ['not-installed'], onLoad() {} }],
    logger: { info() {}, warn() {}, error() {} },
  }), /depends on missing plugin/);
  assert.throws(() => createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 2,
    world,
    plugins: [
      { name: 'plugin-a', dependsOn: ['plugin-b'], onLoad() {} },
      { name: 'plugin-b', dependsOn: ['plugin-a'], onLoad() {} },
    ],
    logger: { info() {}, warn() {}, error() {} },
  }), /dependency cycle/);
});

test('plugins can register deterministic terrain generators for configured worlds', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-custom-generator-'));
  const world = await World.load({
    name: 'custom',
    dimension: 0,
    filePath: join(directory, 'custom.slime'),
    seed: 738n,
    generator: 'test-terrain',
  });
  let generatedChunks = 0;
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 2,
    world,
    plugins: [{
      name: 'test-terrain-plugin',
      onLoad(api) {
        api.worldGenerators.register('test-terrain', (chunkX, chunkZ, context) => {
          assert.equal(context.worldName, 'custom');
          assert.equal(context.dimension, 0);
          assert.equal(context.seed, 738n);
          generatedChunks += 1;
          const chunk = createFlatChunk(chunkX, chunkZ);
          chunk.blocks.fill(42, 10 * 256, 11 * 256);
          return chunk;
        });
      },
    }],
    logger: { info() {}, warn() {}, error() {} },
  });
  let closed = false;
  context.after(async () => {
    if (!closed) await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  const address = await instance.listen();
  assert.ok(address.port > 0);
  const client = await connectTo(address.port, 'TerrainTester');
  context.after(() => client.socket.destroy());
  assert.equal(generatedChunks, 81);
  assert.equal(world.getChunk(0, 0).blocks[10 * 256], 42);
  assert.equal(world.getChunk(20, -3).blocks[10 * 256], 42);
  assert.equal(generatedChunks, 82);
  await instance.close();
  closed = true;
});

test('overworld to overworld world changes pass through the Nether respawn dimension', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-world-switch-'));
  const overworld = await World.load({
    name: 'overworld',
    dimension: 0,
    filePath: join(directory, 'overworld.slime'),
  });
  const nether = await World.load({
    name: 'nether',
    dimension: -1,
    filePath: join(directory, 'nether.slime'),
  });
  const arena = await World.load({
    name: 'arena',
    dimension: 0,
    filePath: join(directory, 'arena.slime'),
  });
  const worlds = new WorldManager([overworld, nether, arena]);
  let changedTo = '';
  const plugin: ServerPlugin = {
    name: 'world-event-test',
    onEnable(api) {
      api.events.on('worldChange', ({ to }) => { changedTo = to.name; });
    },
  };
  const instance = createServer({
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 4,
    worlds,
    plugins: [plugin],
    operators: ['Builder'],
    moderationFile: join(directory, 'moderation.json'),
    logger: { info() {}, warn() {}, error() {} },
  });
  const address = await instance.listen();
  const client = await connectTo(address.port, 'Builder');
  const observer = await connectTo(address.port, 'Observer');
  assert.equal(client.privileges & (1 << 4), 1 << 4);
  context.after(async () => {
    client.socket.destroy();
    observer.socket.destroy();
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.reader.readFrame();
  assert.equal(packetId(await client.reader.readFrame()), 201);
  assert.equal(packetId(await client.reader.readFrame()), 20);
  assert.equal(packetId(await client.reader.readFrame()), 3);
  assert.equal(packetId(await observer.reader.readFrame()), 201);
  assert.equal(packetId(await observer.reader.readFrame()), 20);
  assert.equal(packetId(await observer.reader.readFrame()), 3);
  client.socket.write(frame(new BufferWriter().byte(3).short(0).short(0x10).utf('/gamemode creative').build()));
  const gameModeChange = await client.reader.readFrame();
  assert.deepEqual([...gameModeChange], [70, 3, 1]);
  assert.equal(packetId(await client.reader.readFrame()), 104);
  const updatedPrivileges = await client.reader.readFrame();
  assert.equal(packetId(updatedPrivileges), 201);
  assert.equal(updatedPrivileges.readInt32BE(4) & (1 << 9), 1 << 9);
  assert.match(chatText(await client.reader.readFrame()), /creative/);
  const observerPrivileges = await observer.reader.readFrame();
  assert.equal(packetId(observerPrivileges), 201);
  assert.equal(observerPrivileges.readInt32BE(4) & (1 << 9), 1 << 9);
  client.socket.write(frame(new BufferWriter().byte(3).short(0).short(0x10).utf('/world arena').build()));

  const bridgeRespawn = await client.reader.readFrame();
  const targetRespawn = await client.reader.readFrame();
  assert.equal(packetId(bridgeRespawn), 9);
  assert.equal(bridgeRespawn[1], 0xff);
  assert.equal(packetId(targetRespawn), 9);
  assert.equal(targetRespawn[1], 0);
  assert.equal(packetId(await client.reader.readFrame()), 6);
  assert.equal(packetId(await client.reader.readFrame()), 104);
  assert.equal(packetId(await client.reader.readFrame()), 13);
  for (let index = 0; index < 81; index += 1) {
    assert.equal(packetId(await client.reader.readFrame()), 50);
  }
  assert.equal(packetId(await client.reader.readFrame()), 3);
  assert.equal(changedTo, 'arena');
  assert.equal(packetId(await observer.reader.readFrame()), 29);
  assert.equal(packetId(await observer.reader.readFrame()), 3);

  client.socket.write(frame(new BufferWriter().byte(3).short(0).short(0x10).utf('sync across worlds').build()));
  assert.match(chatText(await client.reader.readFrame()), /sync across worlds/);
  assert.match(chatText(await observer.reader.readFrame()), /sync across worlds/);
});

function createHashXuid(username: string): bigint {
  return createHash('sha256').update(username.trim().toLowerCase(), 'utf8').digest().readBigUInt64BE(0) & 0x7fffffffffffffffn;
}
