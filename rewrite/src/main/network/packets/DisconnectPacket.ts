import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class DisconnectPacket extends GamePacket {
  constructor(public reason = 0) {
    super();
  }

  getId(): number {
    return 255;
  }

  getName(): string {
    return 'Disconnect';
  }

  read(reader: BufferReader): void {
    this.reason = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.reason);
  }
}
