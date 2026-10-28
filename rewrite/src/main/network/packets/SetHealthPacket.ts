import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class SetHealthPacket extends GamePacket {
  constructor(
    public health = 20,
    public food = 20,
    public saturation = 5,
    public damageSource = 0,
  ) {
    super();
  }

  getId(): number {
    return 8;
  }

  getName(): string {
    return 'SetHealth';
  }

  read(reader: BufferReader): void {
    this.health = reader.readFloat();
    this.food = reader.readShort();
    this.saturation = reader.readFloat();
    this.damageSource = reader.readByte();
  }

  write(writer: BufferWriter): void {
    writer.writeFloat(this.health)
      .writeShort(this.food)
      .writeFloat(this.saturation)
      .writeByte(this.damageSource);
  }
}
