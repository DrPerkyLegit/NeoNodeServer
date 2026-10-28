import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class SetSpawnPositionPacket extends GamePacket {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {
    super();
  }

  getId(): number {
    return 6;
  }

  getName(): string {
    return 'SetSpawnPosition';
  }

  read(reader: BufferReader): void {
    this.x = reader.readInt();
    this.y = reader.readInt();
    this.z = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.x).writeInt(this.y).writeInt(this.z);
  }
}
