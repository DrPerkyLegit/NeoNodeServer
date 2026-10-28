import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import type { ItemEntity } from '../../entities/ItemEntity';
import { GamePacket } from './GamePacket';

export class EntityItemMetadataPacket extends GamePacket {
  constructor(public item?: ItemEntity) {
    super();
  }

  getId(): number {
    return 40;
  }

  getName(): string {
    return 'SetEntityData';
  }

  read(reader: BufferReader): void {
    reader.readInt();
    let header = reader.readByte();
    while (header !== 127) {
      const type = header >> 5;
      switch (type) {
        case 0: reader.readByte(); break;
        case 1: reader.readShort(); break;
        case 2: reader.readInt(); break;
        case 3: reader.readFloat(); break;
        case 4: reader.readStringUTF8(); break;
        case 5: {
          reader.readShort();
          reader.readByte();
          reader.readShort();
          const nbtLength = reader.readShort();
          if (nbtLength > 0) reader.readBytes(nbtLength);
          break;
        }
        case 6:
          reader.readInt();
          reader.readInt();
          reader.readInt();
          break;
        default: throw new Error(`Unsupported entity metadata type ${type}`);
      }
      header = reader.readByte();
    }
  }

  write(writer: BufferWriter): void {
    if (!this.item) throw new Error('EntityItemMetadataPacket requires an item entity');
    writer.writeInt(this.item.id)
      .writeByte((5 << 5) | 10)
      .writeShort(this.item.stack.item.id)
      .writeByte(this.item.stack.count)
      .writeShort(this.item.stack.damage)
      .writeShort(-1)
      .writeByte(127);
  }
}
