import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export interface PlayerAbilityFlags {
  readonly invulnerable: boolean;
  readonly flying: boolean;
  readonly canFly: boolean;
  readonly instantBuild: boolean;
  readonly noPhysics: boolean;
}

export class PlayerAbilitiesPacket extends GamePacket {
  constructor(
    public flags: PlayerAbilityFlags = {
      invulnerable: false,
      flying: false,
      canFly: false,
      instantBuild: false,
      noPhysics: false,
    },
    public flyingSpeed = 0.05,
    public walkingSpeed = 0.1,
  ) {
    super();
  }

  getId(): number {
    return 202;
  }

  getName(): string {
    return 'PlayerAbilities';
  }

  read(reader: BufferReader): void {
    const mask = reader.readByte();
    this.flags = {
      invulnerable: (mask & 0x01) !== 0,
      flying: (mask & 0x02) !== 0,
      canFly: (mask & 0x04) !== 0,
      instantBuild: (mask & 0x08) !== 0,
      noPhysics: (mask & 0x10) !== 0,
    };
    this.flyingSpeed = reader.readFloat();
    this.walkingSpeed = reader.readFloat();
  }

  write(writer: BufferWriter): void {
    const mask =
      (this.flags.invulnerable ? 0x01 : 0) |
      (this.flags.flying ? 0x02 : 0) |
      (this.flags.canFly ? 0x04 : 0) |
      (this.flags.instantBuild ? 0x08 : 0) |
      (this.flags.noPhysics ? 0x10 : 0);
    writer.writeByte(mask).writeFloat(this.flyingSpeed).writeFloat(this.walkingSpeed);
  }
}
