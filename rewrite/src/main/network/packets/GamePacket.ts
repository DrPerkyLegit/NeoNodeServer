import { BufferWriter } from "../buffers/BufferWriter";
import { BufferReader } from "../buffers/BufferReader";
import { ServerPacketHandler } from "../ServerPacketHandler";
import type { PacketConnection } from "../PacketConnection";

export abstract class GamePacket {
    public abstract getId(): number;
    public abstract getName(): string;

    public abstract read(dis: BufferReader): void;
    public abstract write(dos: BufferWriter): void;
    public handle(handler: ServerPacketHandler, connection: PacketConnection): void | Promise<void> {
        return handler.handlePacketName(this, connection);
    }

    public encode(): Buffer {
        const id = this.getId();
        if (!Number.isInteger(id) || id < 0 || id > 0xff) {
            throw new RangeError(`Packet ID must be an integer from 0 to 255: ${id}`);
        }
        const writer = new BufferWriter();
        writer.writeByte(id);
        this.write(writer);
        return writer.build();
    }
}