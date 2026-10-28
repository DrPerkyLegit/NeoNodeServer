import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class PlayerInfoPacket extends GamePacket {
  constructor(
    public smallId = 0,
    public playerIndex = 0,
    public privileges = 0,
    public entityId = 0,
  ) {
    super();
  }

  getId(): number {
    return 201;
  }

  getName(): string {
    return 'PlayerInfo';
  }

  read(reader: BufferReader): void {
    this.smallId = reader.readByte();
    this.playerIndex = reader.readShort();
    this.privileges = reader.readInt();
    this.entityId = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.smallId)
      .writeShort(this.playerIndex)
      .writeInt(this.privileges)
      .writeInt(this.entityId);
  }
}
