import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadSlimeWorld, saveSlimeWorld } from '../src/storage/slime';
import { createPlayer } from '../src/server/player';
import { createFlatChunk, setBlock } from '../src/world/chunk';
import { World } from '../src/world/world';

test('writes Slime v10 header and round-trips block sections, players, and seed', () => {
  const chunk = createFlatChunk(-1, 2);
  setBlock(chunk, -1, 10, 32, 1);
  const player = createPlayer('Builder');
  player.x = 2.25;
  player.y = 5;
  player.selectedSlot = 1;
  player.inventory[1] = { id: 3, count: 7, damage: 0 };

  const data = saveSlimeWorld({ chunks: [chunk], seed: 123456789n, players: [player] });
  assert.equal(data.readUInt16BE(0), 0xb10b);
  assert.equal(data[2], 10);

  const loaded = loadSlimeWorld(data);
  assert.equal(loaded.seed, 123456789n);
  assert.equal(loaded.chunks.length, 1);
  assert.equal(loaded.chunks[0].x, -1);
  assert.equal(loaded.chunks[0].z, 2);
  assert.equal(loaded.chunks[0].blocks[10 * 256 + 15], 1);
  assert.equal(loaded.players[0].name, 'Builder');
  assert.equal(loaded.players[0].inventory[1]?.count, 7);
});

test('rejects invalid Slime headers and truncated compressed data', () => {
  assert.throws(() => loadSlimeWorld(Buffer.from([0, 0, 10])), /magic/);
  const valid = saveSlimeWorld({ chunks: [createFlatChunk(0, 0)], seed: 0n, players: [] });
  assert.throws(() => loadSlimeWorld(valid.subarray(0, valid.length - 4)));
});

test('world saves atomically and reloads a modified chunk', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-flat-world-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'flat.slime');
  const world = await World.load({ filePath: path, seed: 42n });
  const chunk = world.getChunk(0, 0);
  setBlock(chunk, 2, 9, 3, 5);
  world.setPlayer(createPlayer('Persisted'));
  await world.save();

  const written = await readFile(path);
  assert.equal(written.readUInt16BE(0), 0xb10b);
  const loaded = await World.load({ filePath: path });
  assert.equal(loaded.seed, 42n);
  assert.equal(loaded.getChunk(0, 0).blocks[9 * 256 + 3 * 16 + 2], 5);
  assert.equal(loaded.players.get('persisted')?.name, 'Persisted');
});
