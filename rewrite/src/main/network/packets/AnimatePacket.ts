import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class AnimatePacket extends GamePacket {
  entityId = 0;
  action = 0;

  getId(): number {
    return 18;
  }

  getName(): string {
    return 'Animate';
  }

  read(reader: BufferReader): void {
    this.entityId = reader.readInt();
    this.action = reader.readByte();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.entityId).writeByte(this.action);
  }
}
