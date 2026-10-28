import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class ChunkVisibilityPacket extends GamePacket {
  constructor(
    public chunkX = 0,
    public chunkZ = 0,
    public visible = true,
  ) {
    super();
  }

  getId(): number {
    return 50;
  }

  getName(): string {
    return 'ChunkVisibility';
  }

  read(reader: BufferReader): void {
    this.chunkX = reader.readInt();
    this.chunkZ = reader.readInt();
    this.visible = reader.readBool();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.chunkX).writeInt(this.chunkZ).writeBool(this.visible);
  }
}
