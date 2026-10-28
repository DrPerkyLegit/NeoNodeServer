import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class AddPlayerPacket extends GamePacket {
  constructor(
    public entityId = 0,
    public username = '',
    public x = 0,
    public y = 0,
    public z = 0,
    public yaw = 0,
    public pitch = 0,
    public playerIndex = 0,
    public privileges = 0,
  ) {
    super();
  }

  getId(): number {
    return 20;
  }

  getName(): string {
    return 'AddPlayer';
  }

  read(reader: BufferReader): void {
    this.entityId = reader.readInt();
    this.username = reader.readStringUTF16(16);
    this.x = reader.readInt() / 32;
    this.y = reader.readInt() / 32;
    this.z = reader.readInt() / 32;
    this.yaw = reader.readByte() * 360 / 256;
    this.pitch = reader.readByte() * 360 / 256;
    reader.readByte();
    reader.readShort();
    reader.readLong();
    reader.readLong();
    this.playerIndex = reader.readByte();
    reader.readInt();
    reader.readInt();
    this.privileges = reader.readInt();
    readEntityMetadata(reader);
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.entityId)
      .writeStringUTF16(this.username)
      .writeInt(Math.floor(this.x * 32))
      .writeInt(Math.floor(this.y * 32))
      .writeInt(Math.floor(this.z * 32))
      .writeByte(rotationByte(this.yaw))
      .writeByte(rotationByte(this.pitch))
      .writeByte(rotationByte(this.yaw))
      .writeShort(0)
      .writeLong(0n)
      .writeLong(0n)
      .writeByte(this.playerIndex)
      .writeInt(0)
      .writeInt(0)
      .writeInt(this.privileges)
      .writeByte(0x00)
      .writeByte(0)
      .writeByte(0x21)
      .writeShort(300)
      .writeByte(0x05)
      .writeByte(0)
      .writeByte(0x66)
      .writeFloat(20)
      .writeByte(0x47)
      .writeInt(0)
      .writeByte(0x08)
      .writeByte(0)
      .writeByte(0x09)
      .writeByte(0)
      .writeByte(0x10)
      .writeByte(0)
      .writeByte(0x71)
      .writeFloat(0)
      .writeByte(0x52)
      .writeInt(0)
      .writeByte(127);
  }
}

function readEntityMetadata(reader: BufferReader): void {
  for (let itemCount = 0; itemCount < 256; itemCount += 1) {
    const header = reader.readByte();
    if (header === 127) return;
    switch (header >> 5) {
      case 0: reader.readByte(); break;
      case 1: reader.readShort(); break;
      case 2: reader.readInt(); break;
      case 3: reader.readFloat(); break;
      case 4: reader.readStringUTF16(64); break;
      case 5: {
        const itemId = reader.readShort();
        if (itemId !== -1) {
          reader.readByte();
          reader.readShort();
          const nbtLength = reader.readShort();
          if (nbtLength > 0) reader.readBytes(nbtLength);
        }
        break;
      }
      case 6:
      case 7:
        reader.readFloat();
        reader.readFloat();
        reader.readFloat();
        break;
      default:
        throw new Error(`Unsupported player entity metadata type ${header >> 5}`);
    }
  }
  throw new Error('Player entity metadata exceeds 256 entries or has no terminator');
}

function rotationByte(degrees: number): number {
  return Math.floor((degrees * 256) / 360);
}
