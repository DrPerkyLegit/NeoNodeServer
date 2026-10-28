import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BufferReader } from '../src/binary';
import {
  BlockRegistry,
  buildCreativeRegistryPacket,
  buildRecipeRegistryPacket,
  createDefaultItemRegistry,
  createDefaultRecipeRegistry,
} from '../src/server/registry';

function readCustomPayload(packet: Buffer): { channel: string; payload: Buffer } {
  assert.equal(packet[0], 250);
  const reader = new BufferReader(packet.subarray(1));
  const channel = reader.utf(20);
  const length = reader.short();
  const payload = Buffer.from(reader.bytes(length));
  assert.equal(reader.offset, packet.length - 1);
  return { channel, payload };
}

test('creative custom payload advertises registered items in all 16 client groups', () => {
  const blocks = new BlockRegistry();
  blocks.register({ id: 300, name: 'minigame block', tab: 0 });
  const { channel, payload } = readCustomPayload(buildCreativeRegistryPacket(blocks));
  assert.equal(channel, 'neo|UpdCReg');

  const reader = new BufferReader(payload);
  const counts: number[] = [];
  let customBlockFound = false;
  for (let group = 0; group < 16; group += 1) {
    const count = reader.short();
    counts.push(count);
    for (let index = 0; index < count; index += 1) {
      const id = reader.short();
      reader.short();
      assert.equal(reader.short(), -1);
      if (group === 0 && id === 300) customBlockFound = true;
    }
  }
  assert.equal(reader.offset, payload.length);
  assert.equal(counts.length, 16);
  assert.ok(customBlockFound);
});

test('item registry advertises standalone items and validates unique names and IDs', () => {
  const items = createDefaultItemRegistry(new BlockRegistry());
  items.register({ id: 32000, name: 'arena token', tab: 15, maxStackSize: 16 });
  const { payload } = readCustomPayload(buildCreativeRegistryPacket(items));
  const reader = new BufferReader(payload);
  let tokenFound = false;
  for (let group = 0; group < 16; group += 1) {
    const count = reader.short();
    for (let index = 0; index < count; index += 1) {
      const id = reader.short();
      reader.short();
      reader.short();
      if (group === 15 && id === 32000) tokenFound = true;
    }
  }
  assert.equal(reader.offset, payload.length);
  assert.ok(tokenFound);
  assert.throws(() => items.register({ id: 32001, name: 'arena token', tab: 15 }), /already registered/);
  assert.throws(() => items.register({ id: 32000, name: 'another token', tab: 15 }), /already registered/);
});

test('recipe custom payload contains valid shaped and shapeless recipe records', () => {
  const { channel, payload } = readCustomPayload(buildRecipeRegistryPacket(createDefaultRecipeRegistry()));
  assert.equal(channel, 'neo|UpdRReg');
  const reader = new BufferReader(payload);
  const count = reader.int();
  assert.equal(count, 5);
  assert.deepEqual(Array.from({ length: count }, () => {
    const type = reader.byte();
    reader.byte();
    reader.short();
    reader.byte();
    reader.short();
    assert.equal(reader.short(), -1);
    if (type === 1) {
      const ingredientCount = reader.byte();
      for (let index = 0; index < ingredientCount; index += 1) {
        assert.equal(reader.bool(), false);
        reader.short();
        reader.short();
        assert.equal(reader.short(), -1);
      }
    } else {
      const size = reader.byte();
      const width = (size >> 2) & 3;
      const height = size & 3;
      for (let index = 0; index < width * height; index += 1) {
        if (reader.bool()) continue;
        reader.short();
        reader.short();
        assert.equal(reader.short(), -1);
      }
    }
    return type;
  }), [1, 2, 2, 2, 2]);
  assert.equal(reader.offset, payload.length);
});
