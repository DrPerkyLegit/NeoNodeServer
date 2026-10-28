import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import type { ItemStack } from '../../items/ItemStack';
import { GamePacket } from './GamePacket';

export class ContainerSetContentPacket extends GamePacket {
  constructor(
    public containerId = 0,
    public items: ReadonlyArray<ItemStack | undefined> = [],
  ) {
    super();
  }

  getId(): number {
    return 104;
  }

  getName(): string {
    return 'ContainerSetContent';
  }

  read(reader: BufferReader): void {
    this.containerId = reader.readByte();
    const count = reader.readShort();
    if (count < 0 || count > 256) throw new Error(`Invalid container item count ${count}`);
    const items: Array<ItemStack | undefined> = [];
    for (let index = 0; index < count; index += 1) {
      const itemId = reader.readShort();
      if (itemId === -1) {
        items.push(undefined);
        continue;
      }
      const quantity = reader.readSignedByte();
      const damage = reader.readShort();
      const nbtLength = reader.readShort();
      if (nbtLength > 0) reader.readBytes(nbtLength);
      items.push(undefined);
      if (quantity < 1 || damage < 0) throw new Error('Invalid container item stack');
    }
    this.items = items;
  }

  write(writer: BufferWriter): void {
    if (this.items.length > 256) throw new RangeError(`Too many container items: ${this.items.length}`);
    writer.writeByte(this.containerId).writeShort(this.items.length);
    for (const stack of this.items) {
      if (!stack || stack.isEmpty) {
        writer.writeShort(-1);
        continue;
      }
      writer.writeShort(stack.item.id)
        .writeByte(stack.count)
        .writeShort(stack.damage)
        .writeShort(-1);
    }
  }
}
