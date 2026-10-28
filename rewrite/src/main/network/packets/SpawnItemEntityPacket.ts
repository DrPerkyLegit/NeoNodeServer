import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import type { ItemEntity } from '../../entities/ItemEntity';
import { GamePacket } from './GamePacket';

export class SpawnItemEntityPacket extends GamePacket {
  constructor(public item?: ItemEntity) {
    super();
  }

  getId(): number {
    return 23;
  }

  getName(): string {
    return 'AddItemEntity';
  }

  read(reader: BufferReader): void {
    reader.readInt();
    reader.readByte();
    reader.readInt();
    reader.readInt();
    reader.readInt();
    reader.readByte();
    reader.readByte();
    if (reader.readInt() > -1) {
      reader.readShort();
      reader.readShort();
      reader.readShort();
    }
  }

  write(writer: BufferWriter): void {
    if (!this.item) throw new Error('SpawnItemEntityPacket requires an item entity');
    writer.writeInt(this.item.id)
      .writeByte(2)
      .writeInt(Math.floor(this.item.x * 32))
      .writeInt(Math.floor(this.item.y * 32))
      .writeInt(Math.floor(this.item.z * 32))
      .writeByte(0)
      .writeByte(0)
      .writeInt(-1);
  }
}
