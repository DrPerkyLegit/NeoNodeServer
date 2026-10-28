import { Buffer } from 'node:buffer';

export class BufferWriter {
    private readonly parts: Buffer[] = [];

    writeByte(value: number): this {
        const data = Buffer.allocUnsafe(1);
        data.writeUInt8(value & 0xff);
        this.parts.push(data);
        return this;
    }

    writeBool(value: boolean): this {
        return this.writeByte(value ? 1 : 0);
    }

    writeShort(value: number): this {
        const data = Buffer.allocUnsafe(2);
        data.writeInt16BE(value);
        this.parts.push(data);
        return this;
    }

    writeUShort(value: number): this {
        const data = Buffer.allocUnsafe(2);
        data.writeUInt16BE(value);
        this.parts.push(data);
        return this;
    }

    writeInt(value: number): this {
        const data = Buffer.allocUnsafe(4);
        data.writeInt32BE(value);
        this.parts.push(data);
        return this;
    }

    writeUInt(value: number): this {
        const data = Buffer.allocUnsafe(4);
        data.writeUInt32BE(value);
        this.parts.push(data);
        return this;
    }

    writeLong(value: bigint): this {
        const data = Buffer.allocUnsafe(8);
        data.writeBigInt64BE(value);
        this.parts.push(data);
        return this;
    }

    writeFloat(value: number): this {
        const data = Buffer.allocUnsafe(4);
        data.writeFloatBE(value);
        this.parts.push(data);
        return this;
    }

    writeDouble(value: number): this {
        const data = Buffer.allocUnsafe(8);
        data.writeDoubleBE(value);
        this.parts.push(data);
        return this;
    }

    writeStringUTF16(value: string): this {
        if (value.length > 0xffff) throw new RangeError('Protocol string is too long');
        const data = Buffer.allocUnsafe(2 + value.length * 2);
        data.writeUInt16BE(value.length, 0);
        for (let i = 0; i < value.length; i += 1) {
            data.writeUInt16BE(value.charCodeAt(i), 2 + i * 2);
        }
        this.parts.push(data);
        return this;
    }

    writeStringUTF8(value: string): this {
        const encoded = Buffer.from(value, 'utf8');
        if (encoded.length > 0xffff) throw new RangeError('NBT string is too long');
        this.writeUShort(encoded.length);
        return this.writeBytes(encoded);
    }

    writeBytes(value: Buffer): this {
        this.parts.push(value);
        return this;
    }

    build(): Buffer {
        return Buffer.concat(this.parts);
    }
}