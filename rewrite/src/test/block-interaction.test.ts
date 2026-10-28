import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ItemEntity } from '../main/entities/ItemEntity';
import { Player } from '../main/entities/Player';
import { ItemStack } from '../main/items/ItemStack';
import { WorldServer } from '../main/server/WorldServer';

async function withWorld(run: (server: WorldServer) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neo-blocks-'));
  try {
    await run(await WorldServer.load(path.join(directory, 'server.properties')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('breaking blocks drops their registered item and bedrock is unbreakable', async () => {
  await withWorld(async (server) => {
    const world = server.worlds.get('defaultWorld');
    assert.ok(world);
    const player = new Player(1, 'Breaker', 1, '127.0.0.1');

    assert.equal(server.interactions.breakBlock(world, player, 0, 3, 0), 2);
    assert.equal(world.getBlock(0, 3, 0), 0);
    const drop = [...world.entities.values()].find((entity) => entity instanceof ItemEntity);
    assert.ok(drop instanceof ItemEntity);
    assert.equal(world.itemEntities.get(drop.id), drop);
    assert.equal(drop.stack.item.id, 3);
    drop.pickupDelayTicks = 0;
    player.teleport({ x: 0.5, y: 3.5, z: 0.5 });
    assert.equal(server.interactions.pickupItem(world, player, drop.id), true);
    assert.equal(world.itemEntities.has(drop.id), false);
    assert.equal(player.inventory.get(0)?.item.id, 3);
    assert.equal(server.interactions.breakBlock(world, player, 0, 0, 0), 0);
    assert.equal(world.getBlock(0, 0, 0), 7);
  });
});

test('placing blocks consumes a matching survival item and item entities can be picked up', async () => {
  await withWorld(async (server) => {
    const world = server.worlds.get('defaultWorld');
    assert.ok(world);
    const player = new Player(1, 'Builder', 1, '127.0.0.1');
    player.teleport({ x: 0.5, y: 4.5, z: 0.5 });
    const dirt = server.items.get(3);
    assert.ok(dirt);
    player.inventory.set(0, new ItemStack(dirt, 2));
    server.interactions.placeBlock(world, player, 0, 4, 0, 3);
    assert.equal(world.getBlock(0, 4, 0), 3);
    assert.equal(player.inventory.get(0)?.count, 1);

    const dropped = server.entities.add(new ItemEntity(
      server.entities.allocateId(),
      new ItemStack(dirt, 1),
      0.5,
      4.5,
      0.5,
    ));
    dropped.pickupDelayTicks = 0;
    world.addEntity(dropped);
    assert.equal(server.interactions.pickupItem(world, player, dropped.id), true);
    assert.equal(world.entities.has(dropped.id), false);
    assert.equal(player.inventory.get(0)?.count, 2);
  });
});

test('picked up items prefer hotbar slots over existing main-inventory stacks', async () => {
  await withWorld(async (server) => {
    const world = server.worlds.get('defaultWorld');
    assert.ok(world);
    const player = new Player(1, 'HotbarFirst', 4, '127.0.0.1');
    player.teleport({ x: 0.5, y: 4.5, z: 0.5 });
    const dirt = server.items.get(3);
    assert.ok(dirt);
    player.inventory.set(9, new ItemStack(dirt, 63));

    const dropped = server.entities.add(new ItemEntity(
      server.entities.allocateId(),
      new ItemStack(dirt, 1),
      0.5,
      4.5,
      0.5,
    ));
    dropped.pickupDelayTicks = 0;
    world.addEntity(dropped);

    assert.equal(server.interactions.pickupItem(world, player, dropped.id), true);
    assert.equal(player.inventory.get(0)?.item.id, dirt.id);
    assert.equal(player.inventory.get(0)?.count, 1);
    assert.equal(player.inventory.get(9)?.count, 63);
  });
});
