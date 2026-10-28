import { Buffer } from 'node:buffer';

export class IncompletePacketError extends Error {
  constructor() {
    super('Incomplete packet');
    this.name = 'IncompletePacketError';
  }
}

export class BufferWriter {
  private readonly parts: Buffer[] = [];

  byte(value: number): this {
    const data = Buffer.allocUnsafe(1);
    data.writeUInt8(value & 0xff);
    this.parts.push(data);
    return this;
  }

  bool(value: boolean): this {
    return this.byte(value ? 1 : 0);
  }

  short(value: number): this {
    const data = Buffer.allocUnsafe(2);
    data.writeInt16BE(value);
    this.parts.push(data);
    return this;
  }

  unsignedShort(value: number): this {
    const data = Buffer.allocUnsafe(2);
    data.writeUInt16BE(value);
    this.parts.push(data);
    return this;
  }

  int(value: number): this {
    const data = Buffer.allocUnsafe(4);
    data.writeInt32BE(value);
    this.parts.push(data);
    return this;
  }

  unsignedInt(value: number): this {
    const data = Buffer.allocUnsafe(4);
    data.writeUInt32BE(value);
    this.parts.push(data);
    return this;
  }

  long(value: bigint): this {
    const data = Buffer.allocUnsafe(8);
    data.writeBigInt64BE(value);
    this.parts.push(data);
    return this;
  }

  float(value: number): this {
    const data = Buffer.allocUnsafe(4);
    data.writeFloatBE(value);
    this.parts.push(data);
    return this;
  }

  double(value: number): this {
    const data = Buffer.allocUnsafe(8);
    data.writeDoubleBE(value);
    this.parts.push(data);
    return this;
  }

  utf(value: string): this {
    if (value.length > 0xffff) throw new RangeError('Protocol string is too long');
    const data = Buffer.allocUnsafe(2 + value.length * 2);
    data.writeUInt16BE(value.length, 0);
    for (let i = 0; i < value.length; i += 1) {
      data.writeUInt16BE(value.charCodeAt(i), 2 + i * 2);
    }
    this.parts.push(data);
    return this;
  }

  utf8(value: string): this {
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > 0xffff) throw new RangeError('NBT string is too long');
    this.unsignedShort(encoded.length);
    return this.bytes(encoded);
  }

  bytes(value: Buffer): this {
    this.parts.push(value);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

export class BufferReader {
  offset = 0;

  constructor(readonly buffer: Buffer) {}

  require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new IncompletePacketError();
    }
  }

  byte(): number {
    this.require(1);
    return this.buffer.readUInt8(this.offset++);
  }

  bool(): boolean {
    return this.byte() !== 0;
  }

  short(): number {
    this.require(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  unsignedShort(): number {
    this.require(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  int(): number {
    this.require(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  long(): bigint {
    this.require(8);
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  float(): number {
    this.require(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  double(): number {
    this.require(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Buffer {
    this.require(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  utf(maxLength = 32767): string {
    const length = this.unsignedShort();
    if (length > maxLength) throw new Error(`Protocol string exceeds ${maxLength} UTF-16 code units`);
    this.require(length * 2);
    const chars: string[] = [];
    for (let i = 0; i < length; i += 1) {
      chars.push(String.fromCharCode(this.buffer.readUInt16BE(this.offset)));
      this.offset += 2;
    }
    return chars.join('');
  }

  utf8(): string {
    const length = this.unsignedShort();
    return this.bytes(length).toString('utf8');
  }
}
