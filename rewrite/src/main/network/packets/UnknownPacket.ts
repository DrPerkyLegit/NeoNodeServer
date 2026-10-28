import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class UnknownPacket extends GamePacket {
  payload = Buffer.alloc(0);

  constructor(private readonly packetId: number) {
    super();
  }

  getId(): number {
    return this.packetId;
  }

  getName(): string {
    return `Unknown${this.packetId}`;
  }

  read(reader: BufferReader): void {
    this.payload = Buffer.from(reader.readBytes(reader.buffer.length - reader.offset));
  }

  write(writer: BufferWriter): void {
    writer.writeBytes(this.payload);
  }
}
