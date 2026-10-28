import { IncompletePacketError } from "../errors/IncompletePacketError";

export class BufferReader {
    offset = 0;

    constructor(readonly buffer: Buffer) {}

    require(length: number): void {
        if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
            throw new IncompletePacketError();
        }
    }

    readByte(): number {
        this.require(1);
        return this.buffer.readUInt8(this.offset++);
    }

    readSignedByte(): number {
        this.require(1);
        return this.buffer.readInt8(this.offset++);
    }

    readBool(): boolean {
        return this.readByte() !== 0;
    }

    readShort(): number {
        this.require(2);
        const value = this.buffer.readInt16BE(this.offset);
        this.offset += 2;
        return value;
    }

    readUShort(): number {
        this.require(2);
        const value = this.buffer.readUInt16BE(this.offset);
        this.offset += 2;
        return value;
    }

    readInt(): number {
        this.require(4);
        const value = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    readUInt(): number {
        this.require(4);
        const value = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    readLong(): bigint {
        this.require(8);
        const value = this.buffer.readBigInt64BE(this.offset);
        this.offset += 8;
        return value;
    }

    readFloat(): number {
        this.require(4);
        const value = this.buffer.readFloatBE(this.offset);
        this.offset += 4;
        return value;
    }

    readDouble(): number {
        this.require(8);
        const value = this.buffer.readDoubleBE(this.offset);
        this.offset += 8;
        return value;
    }

    readBytes(length: number): Buffer {
        this.require(length);
        const value = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    readStringUTF16(maxLength = 32767): string {
        const length = this.readUShort();
        if (length > maxLength) throw new Error(`Protocol string exceeds ${maxLength} UTF-16 code units`);
        this.require(length * 2);
        const chars: string[] = [];
        for (let i = 0; i < length; i += 1) {
            chars.push(String.fromCharCode(this.buffer.readUInt16BE(this.offset)));
            this.offset += 2;
        }
        return chars.join('');
    }

    readStringUTF8(): string {
        const length = this.readUShort();
        return this.readBytes(length).toString('utf8');
    }
}