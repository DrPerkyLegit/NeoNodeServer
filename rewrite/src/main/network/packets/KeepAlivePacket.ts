import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class KeepAlivePacket extends GamePacket {
  constructor(public id = 0) {
    super();
  }

  getId(): number {
    return 0;
  }

  getName(): string {
    return 'KeepAlive';
  }

  read(reader: BufferReader): void {
    this.id = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.id);
  }
}
