import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import type { ItemStack } from '../../items/ItemStack';
import { readItemStack, writeItemStack, writeItemStackData, type ItemStackData } from './ItemStackCodec';
import { GamePacket } from './GamePacket';

export class ContainerSetSlotPacket extends GamePacket {
  constructor(
    public containerId = 0,
    public slot = 0,
    public stack: ItemStack | undefined,
    public itemData: ItemStackData | undefined = undefined,
  ) {
    super();
  }

  getId(): number {
    return 103;
  }

  getName(): string {
    return 'ContainerSetSlot';
  }

  read(reader: BufferReader): void {
    this.containerId = reader.readByte();
    this.slot = reader.readShort();
    this.itemData = readItemStack(reader);
    this.stack = undefined;
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.containerId).writeShort(this.slot);
    if (this.itemData) {
      writeItemStackData(writer, this.itemData);
    } else {
      writeItemStack(writer, this.stack);
    }
  }
}
