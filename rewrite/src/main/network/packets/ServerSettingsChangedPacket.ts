import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class ServerSettingsChangedPacket extends GamePacket {
  static readonly HOST_DIFFICULTY = 0;
  static readonly HOST_OPTIONS = 1;
  static readonly HOST_IN_GAME_SETTINGS = 2;

  constructor(
    public action = ServerSettingsChangedPacket.HOST_DIFFICULTY,
    public data = 1,
  ) {
    super();
  }

  getId(): number {
    return 153;
  }

  getName(): string {
    return 'ServerSettingsChanged';
  }

  read(reader: BufferReader): void {
    this.action = reader.readByte();
    this.data = reader.readUInt();
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.action).writeUInt(this.data);
  }
}
