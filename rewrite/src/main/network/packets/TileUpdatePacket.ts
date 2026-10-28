import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class TileUpdatePacket extends GamePacket {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public blockId = 0,
    public data = 0,
    public dimension = 0,
  ) {
    super();
  }

  getId(): number {
    return 53;
  }

  getName(): string {
    return 'TileUpdate';
  }

  read(reader: BufferReader): void {
    this.x = reader.readInt();
    this.y = reader.readByte();
    this.z = reader.readInt();
    this.blockId = reader.readShort();
    const dataAndDimension = reader.readByte();
    this.data = dataAndDimension & 0x0f;
    this.dimension = (dataAndDimension >>> 4) & 0x0f;
  }

  write(writer: BufferWriter): void {
    if (!Number.isInteger(this.y) || this.y < 0 || this.y > 0xff) {
      throw new RangeError(`Tile update Y coordinate must be from 0 to 255: ${this.y}`);
    }
    if (!Number.isInteger(this.blockId) || this.blockId < 0 || this.blockId > 0xffff) {
      throw new RangeError(`Invalid tile update block ID: ${this.blockId}`);
    }
    if (!Number.isInteger(this.data) || this.data < 0 || this.data > 0x0f) {
      throw new RangeError(`Invalid tile update metadata: ${this.data}`);
    }
    if (!Number.isInteger(this.dimension) || this.dimension < 0 || this.dimension > 0x0f) {
      throw new RangeError(`Invalid tile update dimension: ${this.dimension}`);
    }
    writer.writeInt(this.x)
      .writeByte(this.y)
      .writeInt(this.z)
      .writeShort(this.blockId)
      .writeByte((this.dimension << 4) | this.data);
  }
}
