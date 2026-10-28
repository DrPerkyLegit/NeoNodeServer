import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class ContainerAckPacket extends GamePacket {
  constructor(
    public containerId = 0,
    public transactionId = 0,
    public accepted = false,
  ) {
    super();
  }

  getId(): number {
    return 106;
  }

  getName(): string {
    return 'ContainerAck';
  }

  read(reader: BufferReader): void {
    this.containerId = reader.readByte();
    this.transactionId = reader.readShort();
    this.accepted = reader.readBool();
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.containerId)
      .writeShort(this.transactionId)
      .writeBool(this.accepted);
  }
}
