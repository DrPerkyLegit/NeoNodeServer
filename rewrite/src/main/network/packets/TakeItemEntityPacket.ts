import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class TakeItemEntityPacket extends GamePacket {
  constructor(
    public itemEntityId = 0,
    public playerEntityId = 0,
  ) {
    super();
  }

  getId(): number {
    return 22;
  }

  getName(): string {
    return 'TakeItemEntity';
  }

  read(reader: BufferReader): void {
    this.itemEntityId = reader.readInt();
    this.playerEntityId = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.itemEntityId).writeInt(this.playerEntityId);
  }
}
