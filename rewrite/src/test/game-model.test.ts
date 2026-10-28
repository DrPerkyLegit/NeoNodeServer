import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityRegistry } from '../main/entities/EntityRegistry';
import { Player } from '../main/entities/Player';
import { PlayerManager } from '../main/entities/PlayerManager';
import { Inventory } from '../main/items/Inventory';
import { ItemRegistry } from '../main/items/Item';
import { ItemStack } from '../main/items/ItemStack';

test('Inventory stacks, removes, and returns item overflow', () => {
  const items = new ItemRegistry();
  const blocks = items.register({ id: 1, name: 'stone', maxStackSize: 64, maxDamage: 0 });
  const inventory = new Inventory(2);

  inventory.set(0, new ItemStack(blocks, 60));
  const overflow = inventory.add(new ItemStack(blocks, 10));
  assert.equal(overflow, undefined);
  assert.equal(inventory.get(0)?.count, 64);
  assert.equal(inventory.get(1)?.count, 6);

  assert.equal(inventory.take(0, 3)?.count, 3);
  assert.equal(inventory.get(0)?.count, 61);
});

test('Inventory reports overflow when no more slots are available', () => {
  const items = new ItemRegistry();
  const blocks = items.register({ id: 1, name: 'stone', maxStackSize: 64, maxDamage: 0 });
  const inventory = new Inventory(1);
  inventory.set(0, new ItemStack(blocks, 64));

  const overflow = inventory.add(new ItemStack(blocks, 2));
  assert.equal(overflow?.count, 2);
});

test('Entity registry allocates unique IDs and tracks players', () => {
  const entities = new EntityRegistry();
  const player = entities.add(new Player(entities.allocateId(), 'PlayerOne', 1, '127.0.0.1'));
  assert.equal(entities.get(player.id), player);
  assert.equal(entities.remove(player.id), player);
  assert.equal(entities.allocateId(), 2);
});

test('Player manager prevents duplicate names and removes players cleanly', () => {
  const entities = new EntityRegistry();
  const players = new PlayerManager(entities, 2);
  const firstConnection = { smallId: 1, remoteAddress: '127.0.0.1:1000', send: () => {} };
  const secondConnection = { smallId: 2, remoteAddress: '127.0.0.1:1001', send: () => {} };
  const player = players.join(firstConnection, 'PlayerOne');

  assert.equal(players.getByName('playerone'), player);
  assert.throws(() => players.join(secondConnection, 'PLAYERONE'), /already online/);
  assert.equal(players.leave(firstConnection), player);
  assert.equal(players.getByName('PlayerOne'), undefined);
  assert.equal(entities.get(player.id), undefined);
});
