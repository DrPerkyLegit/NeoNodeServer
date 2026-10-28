import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { readItemStack, writeItemStackData, type ItemStackData } from './ItemStackCodec';
import { GamePacket } from './GamePacket';

export class ContainerClickPacket extends GamePacket {
  containerId = 0;
  slot = 0;
  button = 0;
  transactionId = 0;
  clickType = 0;
  item: ItemStackData | undefined;

  getId(): number {
    return 102;
  }

  getName(): string {
    return 'ContainerClick';
  }

  read(reader: BufferReader): void {
    this.containerId = reader.readByte();
    this.slot = reader.readShort();
    this.button = reader.readByte();
    this.transactionId = reader.readShort();
    this.clickType = reader.readByte();
    this.item = readItemStack(reader);
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.containerId)
      .writeShort(this.slot)
      .writeByte(this.button)
      .writeShort(this.transactionId)
      .writeByte(this.clickType);
    writeItemStackData(writer, this.item);
  }
}
