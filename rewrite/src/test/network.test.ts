import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BufferReader } from '../main/network/buffers/BufferReader';
import { BufferWriter } from '../main/network/buffers/BufferWriter';
import { PacketRegistry } from '../main/network/PacketRegistry';
import { ServerPacketHandler } from '../main/network/ServerPacketHandler';
import { TcpGameServer } from '../main/network/TcpGameServer';
import { GamePacket } from '../main/network/packets/GamePacket';
import { PluginManager } from '../main/plugin/PluginManager';

class ProbePacket extends GamePacket {
  value = 0;

  getId(): number {
    return 42;
  }

  getName(): string {
    return 'Probe';
  }

  read(reader: BufferReader): void {
    this.value = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.value);
  }
}

class ProbeResponsePacket extends GamePacket {
  constructor(public value: number) {
    super();
  }

  getId(): number {
    return 43;
  }

  getName(): string {
    return 'ProbeResponse';
  }

  read(reader: BufferReader): void {
    this.value = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.value);
  }
}

test('plugins can edit inbound and outbound packets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neo-plugin-test-'));
  const pluginFile = path.join(directory, 'packet-plugin.cjs');
  await writeFile(pluginFile, `
    module.exports = {
      name: 'packet-editor',
      onEnable(api) {
        api.on('packet:inbound:Probe', ({ packet }) => { packet.value += 3; });
        api.on('packet:outbound:ProbeResponse', ({ packet }) => { packet.value += 5; });
      }
    };
  `);
  const plugins = new PluginManager(directory, {});
  await plugins.load(pluginFile);
  const registry = new PacketRegistry().register('Probe', () => new ProbePacket());
  const handler = new ServerPacketHandler();
  let dispatchedValue = 0;
  handler.registerPacketHandler('Probe', (packet, connection) => {
    assert.ok(packet instanceof ProbePacket);
    dispatchedValue = packet.value;
    connection.send(new ProbeResponsePacket(packet.value));
  });
  const server = new TcpGameServer(registry, handler, undefined, plugins);
  const address = await server.listen('127.0.0.1', 0);
  const client = connect({ host: address.address, port: address.port });
  try {
    await once(client, 'connect');
    await once(client, 'data');
    const responsePromise = once(client, 'data') as Promise<[Buffer]>;
    const request = new ProbePacket();
    request.value = 10;
    client.write(framePacket(request.encode()));
    const [response] = await responsePromise;
    assert.equal(dispatchedValue, 13);
    assert.equal(response.readUInt32BE(0), 5);
    assert.deepEqual(response.subarray(4), Buffer.from([43, 0, 0, 0, 18]));
  } finally {
    client.destroy();
    await server.close();
    await plugins.disableAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('TCP networking buffers fragmented packets and dispatches through handlePacketName', async () => {
  const registry = new PacketRegistry().register('Probe', () => new ProbePacket());
  const handler = new ServerPacketHandler();
  let dispatchedPacket: ProbePacket | undefined;
  handler.registerPacketHandler('Probe', (packet, connection) => {
    assert.ok(packet instanceof ProbePacket);
    dispatchedPacket = packet;
    connection.send(new ProbeResponsePacket(packet.value));
  });

  const server = new TcpGameServer(registry, handler);
  const address = await server.listen('127.0.0.1', 0);
  const client = connect({ host: address.address, port: address.port });
  try {
    await once(client, 'connect');
    const [smallId] = await once(client, 'data') as [Buffer];
    assert.equal(smallId.length, 1);
    assert.equal(smallId[0], 4);
    const connection = server.getConnectionBySmallId(smallId[0]);
    assert.ok(connection);
    assert.equal(connection.smallId, smallId[0]);

    const responsePromise = once(client, 'data') as Promise<[Buffer]>;
    const request = framePacket(Buffer.from([42, 0, 0, 0, 9]));
    client.write(request.subarray(0, 3));
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.write(request.subarray(3));

    const [response] = await responsePromise;
    assert.equal(response.readUInt32BE(0), 5);
    assert.deepEqual(response.subarray(4), Buffer.from([43, 0, 0, 0, 9]));
    assert.equal(dispatchedPacket?.value, 9);
  } finally {
    client.destroy();
    await server.close();
  }
});

test('TCP networking decodes multiple game packets inside one transport frame', async () => {
  const registry = new PacketRegistry().register('Probe', () => new ProbePacket());
  const handler = new ServerPacketHandler();
  const receivedValues: number[] = [];
  handler.registerPacketHandler('Probe', (packet) => {
    assert.ok(packet instanceof ProbePacket);
    receivedValues.push(packet.value);
  });

  const server = new TcpGameServer(registry, handler);
  const address = await server.listen('127.0.0.1', 0);
  const client = connect({ host: address.address, port: address.port });
  try {
    await once(client, 'connect');
    await once(client, 'data');
    const packetOne = new ProbePacket();
    packetOne.value = 11;
    const packetTwo = new ProbePacket();
    packetTwo.value = 22;
    client.write(framePacket(Buffer.concat([packetOne.encode(), packetTwo.encode()])));

    await waitFor(() => receivedValues.length === 2);
    assert.deepEqual(receivedValues, [11, 22]);
  } finally {
    client.destroy();
    await server.close();
  }
});

test('TCP networking ignores unknown packets without disconnecting', async () => {
  const registry = new PacketRegistry().register('Probe', () => new ProbePacket());
  const handler = new ServerPacketHandler();
  let probeReceived = false;
  handler.registerPacketHandler('Probe', () => {
    probeReceived = true;
  });

  const server = new TcpGameServer(registry, handler);
  const address = await server.listen('127.0.0.1', 0);
  const client = connect({ host: address.address, port: address.port });
  try {
    await once(client, 'connect');
    await once(client, 'data');
    client.write(framePacket(Buffer.from([250, 1, 2, 3])));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(client.destroyed, false);

    const probe = new ProbePacket();
    probe.value = 12;
    client.write(framePacket(probe.encode()));
    await waitFor(() => probeReceived);
    assert.equal(client.destroyed, false);
  } finally {
    client.destroy();
    await server.close();
  }
});

test('TCP networking assigns unique small IDs and releases them on disconnect', async () => {
  const server = new TcpGameServer(new PacketRegistry(), new ServerPacketHandler(), 2);
  const address = await server.listen('127.0.0.1', 0);
  const first = connect({ host: address.address, port: address.port });
  const second = connect({ host: address.address, port: address.port });
  try {
    await Promise.all([once(first, 'connect'), once(second, 'connect')]);
    const [[firstId], [secondId]] = await Promise.all([
      once(first, 'data') as Promise<[Buffer]>,
      once(second, 'data') as Promise<[Buffer]>,
    ]);

    assert.notEqual(firstId[0], secondId[0]);
    assert.deepEqual([firstId[0], secondId[0]].sort(), [4, 5]);
    assert.ok(server.getConnectionBySmallId(firstId[0]));
    assert.ok(server.getConnectionBySmallId(secondId[0]));

    first.destroy();
    await once(first, 'close');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.getConnectionBySmallId(firstId[0]), undefined);

    const third = connect({ host: address.address, port: address.port });
    try {
      await once(third, 'connect');
      const [thirdId] = await once(third, 'data') as [Buffer];
      assert.equal(thirdId[0], firstId[0]);
    } finally {
      third.destroy();
    }
  } finally {
    first.destroy();
    second.destroy();
    await server.close();
  }
});

test('packet registry rejects duplicate IDs and invalid names', () => {
  const registry = new PacketRegistry();
  registry.register('Probe', () => new ProbePacket());
  assert.throws(() => registry.register('Other', () => new ProbePacket()), /already registered/);
  assert.throws(() => registry.register('invalid-name', () => new ProbePacket()), /Invalid packet name/);
});

function framePacket(packet: Buffer): Buffer {
  const frame = Buffer.alloc(4 + packet.length);
  frame.writeUInt32BE(packet.length);
  packet.copy(frame, 4);
  return frame;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for packet handler');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
