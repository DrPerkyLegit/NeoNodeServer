import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

const MAX_CHAT_ARGUMENTS = 15;

export class ChatPacket extends GamePacket {
  messageType = 0;
  strings: string[] = [];
  integers: number[] = [];

  static message(message: string): ChatPacket {
    const packet = new ChatPacket();
    packet.strings = [message];
    return packet;
  }

  getId(): number {
    return 3;
  }

  getName(): string {
    return 'Chat';
  }

  read(reader: BufferReader): void {
    this.messageType = reader.readShort();
    const argumentCounts = reader.readUShort();
    const stringCount = (argumentCounts >> 4) & 0x0f;
    const integerCount = argumentCounts & 0x0f;
    if (stringCount > MAX_CHAT_ARGUMENTS || integerCount > MAX_CHAT_ARGUMENTS) {
      throw new Error('Chat packet contains too many arguments');
    }

    this.strings = Array.from({ length: stringCount }, () => reader.readStringUTF16(256));
    this.integers = Array.from({ length: integerCount }, () => reader.readInt());
  }

  write(writer: BufferWriter): void {
    if (this.strings.length > MAX_CHAT_ARGUMENTS || this.integers.length > MAX_CHAT_ARGUMENTS) {
      throw new RangeError('Chat packet contains too many arguments');
    }
    writer.writeShort(this.messageType)
      .writeUShort((this.strings.length << 4) | this.integers.length);
    for (const string of this.strings) writer.writeStringUTF16(string);
    for (const integer of this.integers) writer.writeInt(integer);
  }
}
