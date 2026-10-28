import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class PlayerInputPacket extends GamePacket {
  sideways = 0;
  forward = 0;
  jumping = false;
  sneaking = false;

  getId(): number {
    return 27;
  }

  getName(): string {
    return 'PlayerInput';
  }

  read(reader: BufferReader): void {
    this.sideways = reader.readFloat();
    this.forward = reader.readFloat();
    this.jumping = reader.readBool();
    this.sneaking = reader.readBool();
  }

  write(writer: BufferWriter): void {
    writer.writeFloat(this.sideways)
      .writeFloat(this.forward)
      .writeBool(this.jumping)
      .writeBool(this.sneaking);
  }
}
