import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class SetTimePacket extends GamePacket {
  constructor(
    public gameTime = 0n,
    public dayTime = 6000n,
  ) {
    super();
  }

  getId(): number {
    return 4;
  }

  getName(): string {
    return 'SetTime';
  }

  read(reader: BufferReader): void {
    this.gameTime = reader.readLong();
    this.dayTime = reader.readLong();
  }

  write(writer: BufferWriter): void {
    writer.writeLong(this.gameTime).writeLong(this.dayTime);
  }
}
