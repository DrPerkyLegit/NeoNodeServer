import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { readItemStack, writeItemStackData, type ItemStackData } from './ItemStackCodec';
import { GamePacket } from './GamePacket';

export class UseItemPacket extends GamePacket {
  x = 0;
  y = 0;
  z = 0;
  face = 0;
  item: ItemStackData | undefined;
  clickX = 0;
  clickY = 0;
  clickZ = 0;

  getId(): number {
    return 15;
  }

  getName(): string {
    return 'UseItem';
  }

  read(reader: BufferReader): void {
    this.x = reader.readInt();
    this.y = reader.readByte();
    this.z = reader.readInt();
    this.face = reader.readByte();
    this.item = readItemStack(reader);
    this.clickX = reader.readByte() / 16;
    this.clickY = reader.readByte() / 16;
    this.clickZ = reader.readByte() / 16;
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.x)
      .writeByte(this.y)
      .writeInt(this.z)
      .writeByte(this.face);
    writeItemStackData(writer, this.item);
    writer.writeByte(Math.round(this.clickX * 16))
      .writeByte(Math.round(this.clickY * 16))
      .writeByte(Math.round(this.clickZ * 16));
  }
}
