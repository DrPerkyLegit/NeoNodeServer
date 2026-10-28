import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class TeleportEntityPacket extends GamePacket {
  constructor(
    public entityId = 0,
    public x = 0,
    public y = 0,
    public z = 0,
    public yaw = 0,
    public pitch = 0,
  ) {
    super();
  }

  getId(): number {
    return 34;
  }

  getName(): string {
    return 'TeleportEntity';
  }

  read(reader: BufferReader): void {
    this.entityId = reader.readInt();
    this.x = reader.readInt() / 32;
    this.y = reader.readInt() / 32;
    this.z = reader.readInt() / 32;
    this.yaw = reader.readByte() * 360 / 256;
    this.pitch = reader.readByte() * 360 / 256;
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.entityId)
      .writeInt(Math.floor(this.x * 32))
      .writeInt(Math.floor(this.y * 32))
      .writeInt(Math.floor(this.z * 32))
      .writeByte(rotationByte(this.yaw))
      .writeByte(rotationByte(this.pitch));
  }
}

function rotationByte(degrees: number): number {
  return Math.floor((degrees * 256) / 360);
}
