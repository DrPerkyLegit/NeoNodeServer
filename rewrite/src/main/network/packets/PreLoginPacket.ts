import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export interface PreLoginResponse {
  readonly netcodeVersion: number;
  readonly loginKey: string;
  readonly friendsOnlyBits: number;
  readonly ugcPlayersVersion: number;
  readonly uniqueSaveName: Buffer;
  readonly serverSettings: number;
  readonly hostIndex: number;
  readonly texturePackId: number;
}

const SAVE_NAME_LENGTH = 14;
const MAX_ADVERTISED_PLAYERS = 8;

export class PreLoginPacket extends GamePacket {
  netcodeVersion = 0;
  loginKey = '';
  friendsOnlyBits = 0;
  ugcPlayersVersion = 0;
  private advertisedPlayerCount = 0;
  private readonly uniqueSaveName = Buffer.alloc(SAVE_NAME_LENGTH);
  serverSettings = 0;
  hostIndex = 0;
  texturePackId = 0;

  static response(values: PreLoginResponse): PreLoginPacket {
    const packet = new PreLoginPacket();
    packet.netcodeVersion = values.netcodeVersion;
    packet.loginKey = values.loginKey;
    packet.friendsOnlyBits = values.friendsOnlyBits;
    packet.ugcPlayersVersion = values.ugcPlayersVersion;
    packet.uniqueSaveName.set(validateSaveName(values.uniqueSaveName));
    packet.serverSettings = values.serverSettings;
    packet.hostIndex = values.hostIndex;
    packet.texturePackId = values.texturePackId;
    return packet;
  }

  getId(): number {
    return 2;
  }

  getName(): string {
    return 'PreLogin';
  }

  read(reader: BufferReader): void {
    this.netcodeVersion = reader.readShort();
    this.loginKey = reader.readStringUTF16(32);
    this.friendsOnlyBits = reader.readByte();
    this.ugcPlayersVersion = reader.readInt();
    this.advertisedPlayerCount = reader.readByte();
    if (this.advertisedPlayerCount > MAX_ADVERTISED_PLAYERS) {
      throw new Error(`Pre-login advertises ${this.advertisedPlayerCount} players; maximum is ${MAX_ADVERTISED_PLAYERS}`);
    }
    for (let index = 0; index < this.advertisedPlayerCount; index += 1) reader.readLong();
    reader.readBytes(SAVE_NAME_LENGTH).copy(this.uniqueSaveName);
    this.serverSettings = reader.readInt();
    this.hostIndex = reader.readByte();
    this.texturePackId = reader.readInt();
  }

  write(writer: BufferWriter): void {
    writer.writeShort(this.netcodeVersion)
      .writeStringUTF16(this.loginKey)
      .writeByte(this.friendsOnlyBits)
      .writeInt(this.ugcPlayersVersion)
      .writeByte(0)
      .writeBytes(this.uniqueSaveName)
      .writeInt(this.serverSettings)
      .writeByte(this.hostIndex)
      .writeInt(this.texturePackId);
  }

}

function validateSaveName(value: Buffer): Buffer {
  if (value.length !== SAVE_NAME_LENGTH) {
    throw new RangeError(`Unique save name must contain exactly ${SAVE_NAME_LENGTH} bytes`);
  }
  return value;
}
