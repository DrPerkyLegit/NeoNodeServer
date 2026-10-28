import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ServerProperties } from '../main/config/ServerProperties';
import { SlimeWorldStorage } from '../main/storage/SlimeWorldStorage';
import { WorldServer } from '../main/server/WorldServer';
import { FlatWorldGenerator } from '../main/world/generators/FlatWorldGenerator';
import { World } from '../main/world/World';

async function inTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neo-rewrite-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('ServerProperties creates default configuration when missing', async () => {
  await inTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'server.properties');
    const properties = await ServerProperties.load(filePath);
    const contents = await readFile(filePath, 'utf8');

    assert.equal(properties.host, '0.0.0.0');
    assert.equal(properties.port, 25565);
    assert.equal(properties.gamertags, true);
    assert.equal(properties.worldName, 'defaultWorld');
    assert.equal(properties.getWorldFilePath(), path.join(directory, 'worlds', 'defaultWorld.slime'));
    assert.match(contents, /worldType=flat/);
    assert.match(contents, /gamertags=true/);
  });
});

test('flat generator creates the configured bedrock, dirt, and grass layers', () => {
  const chunk = new FlatWorldGenerator().generate(-2, 3, 0n);
  assert.equal(chunk.x, -2);
  assert.equal(chunk.z, 3);
  assert.equal(chunk.getBlock(0, 0, 0), 7);
  assert.equal(chunk.getBlock(15, 1, 15), 3);
  assert.equal(chunk.getBlock(5, 2, 5), 3);
  assert.equal(chunk.getBlock(8, 3, 8), 2);
  assert.equal(chunk.getBlock(8, 4, 8), 0);
});

test('Slime worlds save and reload generated and modified chunks', async () => {
  await inTemporaryDirectory(async (directory) => {
    const filePath = path.join(directory, 'world.slime');
    const world = await World.load({
      name: 'test',
      filePath,
      seed: 1n,
      generator: new FlatWorldGenerator(),
    });

    world.setBlock(-1, 10, -1, 5);
    assert.equal(world.getBlock(-1, 10, -1), 5);
    await world.save();

    const saved = await SlimeWorldStorage.load(filePath);
    assert.equal(saved.chunks.length, 1);
    const reloaded = await World.load({
      name: 'test',
      filePath,
      seed: 1n,
      generator: new FlatWorldGenerator(),
    });
    assert.equal(reloaded.getBlock(-1, 10, -1), 5);
    assert.equal(reloaded.getBlock(-1, 3, -1), 2);

    reloaded.setBlock(-1, 10, -1, 0);
    assert.equal(reloaded.getChunk(-1, -1).heightMap[15 * 16 + 15], 4);
  });
});

test('WorldServer loads configured flat world and saves spawn chunk', async () => {
  await inTemporaryDirectory(async (directory) => {
    const propertiesPath = path.join(directory, 'server.properties');
    await writeFile(propertiesPath, [
      'host=127.0.0.1',
      'port=25570',
      'maxPlayers=12',
      'worldName=integration',
      'worldType=flat',
      'seed=987',
      '',
    ].join('\n'));

    const server = await WorldServer.load(propertiesPath);
    const world = server.worlds.get('INTEGRATION');
    assert.ok(world);
    assert.equal(world.getBlock(0, 3, 0), 2);
    await server.save();
    assert.equal((await SlimeWorldStorage.load(server.properties.getWorldFilePath())).chunks.length, 1);
  });
});

test('invalid server properties are rejected', () => {
  assert.throws(
    () => ServerProperties.parse('port=70000\n'),
    /server\.properties port must be from 1 to 65535/,
  );
  assert.throws(
    () => ServerProperties.parse('unknown=value\n'),
    /Unknown server\.properties key/,
  );
  assert.equal(ServerProperties.parse('gamertags=false\n').gamertags, false);
  assert.throws(
    () => ServerProperties.parse('gamertags=yes\n'),
    /server\.properties gamertags must be true or false/,
  );
});
