import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export enum PlayerAction {
  StartDestroyBlock = 0,
  AbortDestroyBlock = 1,
  StopDestroyBlock = 2,
  DropAllItems = 3,
  DropItem = 4,
  ReleaseUseItem = 5,
}

export class PlayerActionPacket extends GamePacket {
  action = PlayerAction.StartDestroyBlock;
  x = 0;
  y = 0;
  z = 0;
  face = 0;

  getId(): number {
    return 14;
  }

  getName(): string {
    return 'PlayerAction';
  }

  read(reader: BufferReader): void {
    this.action = reader.readByte();
    this.x = reader.readInt();
    this.y = reader.readByte();
    this.z = reader.readInt();
    this.face = reader.readByte();
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.action)
      .writeInt(this.x)
      .writeByte(this.y)
      .writeInt(this.z)
      .writeByte(this.face);
  }
}
