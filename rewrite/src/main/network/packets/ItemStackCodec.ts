import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import type { ItemStack } from '../../items/ItemStack';

export interface ItemStackData {
  readonly itemId: number;
  readonly count: number;
  readonly damage: number;
  readonly nbt?: Buffer;
}

export function readItemStack(reader: BufferReader): ItemStackData | undefined {
  const itemId = reader.readShort();
  if (itemId === -1) return undefined;
  if (itemId < 0 || itemId >= 32_000) throw new Error(`Invalid item ID ${itemId} in packet`);

  const count = reader.readSignedByte();
  const damage = reader.readShort();
  const nbtLength = reader.readShort();
  const nbt = nbtLength > 0 ? Buffer.from(reader.readBytes(nbtLength)) : undefined;
  if (count < 0) throw new Error(`Invalid item stack count ${count} in packet`);
  if (count === 0) return undefined;
  return { itemId, count, damage, nbt };
}

export function writeItemStack(writer: BufferWriter, stack: ItemStack | undefined): void {
  if (!stack) {
    writeItemStackData(writer);
    return;
  }
  writeItemStackData(writer, { itemId: stack.item.id, count: stack.count, damage: stack.damage });
}

export function writeItemStackData(writer: BufferWriter, stack?: ItemStackData): void {
  if (!stack) {
    writer.writeShort(-1);
    return;
  }
  if (!Number.isInteger(stack.itemId) || stack.itemId < 0 || stack.itemId >= 32_000) {
    throw new RangeError(`Invalid item ID ${stack.itemId}`);
  }
  if (!Number.isInteger(stack.count) || stack.count < 1 || stack.count > 127) {
    throw new RangeError(`Invalid item stack count ${stack.count}`);
  }
  if (!Number.isInteger(stack.damage) || stack.damage < -32768 || stack.damage > 32767) {
    throw new RangeError(`Invalid item damage ${stack.damage}`);
  }
  const nbtLength = stack.nbt?.length ?? 0;
  if (nbtLength > 32_767) throw new RangeError(`Item NBT payload exceeds 32767 bytes: ${nbtLength}`);
  writer.writeShort(stack.itemId)
    .writeByte(stack.count)
    .writeShort(stack.damage)
    .writeShort(nbtLength);
  if (stack.nbt) writer.writeBytes(stack.nbt);
}
