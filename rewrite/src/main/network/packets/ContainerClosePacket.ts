import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class ContainerClosePacket extends GamePacket {
  constructor(public containerId = 0) {
    super();
  }

  getId(): number {
    return 101;
  }

  getName(): string {
    return 'ContainerClose';
  }

  read(reader: BufferReader): void {
    this.containerId = reader.readByte();
  }

  write(writer: BufferWriter): void {
    writer.writeByte(this.containerId);
  }
}
