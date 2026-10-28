import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class SetCarriedItemPacket extends GamePacket {
  constructor(public slot = 0) {
    super();
  }

  getId(): number {
    return 16;
  }

  getName(): string {
    return 'SetCarriedItem';
  }

  read(reader: BufferReader): void {
    this.slot = reader.readShort();
  }

  write(writer: BufferWriter): void {
    writer.writeShort(this.slot);
  }
}
