import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export type MovePlayerVariant = 'ground' | 'position' | 'rotation' | 'positionRotation';

const variantIds: Record<MovePlayerVariant, number> = {
  ground: 10,
  position: 11,
  rotation: 12,
  positionRotation: 13,
};

const packetNames: Record<MovePlayerVariant, string> = {
  ground: 'MovePlayerGround',
  position: 'MovePlayerPosition',
  rotation: 'MovePlayerRotation',
  positionRotation: 'MovePlayerPositionRotation',
};

export class MovePlayerPacket extends GamePacket {
  x = 0;
  y = 0;
  stance = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  isFlying = false;

  constructor(public readonly variant: MovePlayerVariant) {
    super();
  }

  getId(): number {
    return variantIds[this.variant];
  }

  getName(): string {
    return packetNames[this.variant];
  }

  read(reader: BufferReader): void {
    if (this.variant === 'position' || this.variant === 'positionRotation') {
      this.x = reader.readDouble();
      this.y = reader.readDouble();
      this.stance = reader.readDouble();
      this.z = reader.readDouble();
    }
    if (this.variant === 'rotation' || this.variant === 'positionRotation') {
      this.yaw = reader.readFloat();
      this.pitch = reader.readFloat();
    }
    const flags = reader.readByte();
    this.onGround = (flags & 0x01) !== 0;
    this.isFlying = (flags & 0x02) !== 0;
  }

  write(writer: BufferWriter): void {
    if (this.variant === 'position' || this.variant === 'positionRotation') {
      writer.writeDouble(this.x)
        .writeDouble(this.y)
        .writeDouble(this.stance)
        .writeDouble(this.z);
    }
    if (this.variant === 'rotation' || this.variant === 'positionRotation') {
      writer.writeFloat(this.yaw).writeFloat(this.pitch);
    }
    writer.writeByte((this.onGround ? 1 : 0) | (this.isFlying ? 2 : 0));
  }
}
