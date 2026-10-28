import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class PlayerCommandPacket extends GamePacket {
  entityId = 0;
  action = 0;
  data = 0;

  getId(): number {
    return 19;
  }

  getName(): string {
    return 'PlayerCommand';
  }

  read(reader: BufferReader): void {
    this.entityId = reader.readInt();
    this.action = reader.readByte();
    this.data = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.entityId).writeByte(this.action).writeInt(this.data);
  }
}
