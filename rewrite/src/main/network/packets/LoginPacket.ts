import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class LoginPacket extends GamePacket {
  clientVersion = 0;
  username = '';
  levelType = '';
  seed = 0n;
  gameType = 0;
  dimension = 0;
  mapHeight = 256;
  maxPlayers = 20;
  friendsOnlyUgc = false;
  ugcPlayersVersion = 0;
  difficulty = 1;
  multiplayerInstanceId = 0;
  playerIndex = 0;
  skinId = 0;
  capeId = 0;
  isGuest = false;
  newSeaLevel = false;
  uiGamePrivileges = 0;
  xzSize = 320;
  hellScale = 8;

  getId(): number {
    return 1;
  }

  getName(): string {
    return 'Login';
  }

  read(reader: BufferReader): void {
    this.clientVersion = reader.readInt();
    this.username = reader.readStringUTF16(16);
    this.levelType = reader.readStringUTF16(16);
    this.seed = reader.readLong();
    this.gameType = reader.readInt();
    this.dimension = toSignedByte(reader.readByte());
    this.mapHeight = reader.readByte();
    this.maxPlayers = reader.readByte();
    reader.readLong();
    reader.readLong();
    this.friendsOnlyUgc = reader.readBool();
    this.ugcPlayersVersion = reader.readInt();
    this.difficulty = reader.readByte();
    this.multiplayerInstanceId = reader.readInt();
    this.playerIndex = reader.readByte();
    this.skinId = reader.readInt();
    this.capeId = reader.readInt();
    this.isGuest = reader.readBool();
    this.newSeaLevel = reader.readBool();
    this.uiGamePrivileges = reader.readInt();
    this.xzSize = reader.readShort();
    this.hellScale = reader.readByte();
  }

  write(writer: BufferWriter): void {
    writer.writeInt(this.clientVersion)
      .writeStringUTF16(this.username)
      .writeStringUTF16(this.levelType)
      .writeLong(this.seed)
      .writeInt(this.gameType)
      .writeByte(this.dimension)
      .writeByte(this.mapHeight)
      .writeByte(this.maxPlayers)
      .writeLong(0n)
      .writeLong(0n)
      .writeBool(this.friendsOnlyUgc)
      .writeInt(this.ugcPlayersVersion)
      .writeByte(this.difficulty)
      .writeInt(this.multiplayerInstanceId)
      .writeByte(this.playerIndex)
      .writeInt(this.skinId)
      .writeInt(this.capeId)
      .writeBool(this.isGuest)
      .writeBool(this.newSeaLevel)
      .writeInt(this.uiGamePrivileges)
      .writeShort(this.xzSize)
      .writeByte(this.hellScale);
  }
}

function toSignedByte(value: number): number {
  return value > 0x7f ? value - 0x100 : value;
}
