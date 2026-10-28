import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { GamePacket } from './GamePacket';

export class RemoveEntitiesPacket extends GamePacket {
  constructor(public entityIds: number[] = []) {
    super();
  }

  getId(): number {
    return 29;
  }

  getName(): string {
    return 'RemoveEntities';
  }

  read(reader: BufferReader): void {
    const count = reader.readByte();
    this.entityIds = Array.from({ length: count }, () => reader.readInt());
  }

  write(writer: BufferWriter): void {
    if (this.entityIds.length > 255) throw new RangeError('Cannot remove more than 255 entities at once');
    writer.writeByte(this.entityIds.length);
    for (const entityId of this.entityIds) writer.writeInt(entityId);
  }
}
