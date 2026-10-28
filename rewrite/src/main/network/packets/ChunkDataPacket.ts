import { deflateSync } from 'node:zlib';
import { BufferReader } from '../buffers/BufferReader';
import { BufferWriter } from '../buffers/BufferWriter';
import { CHUNK_WIDTH, WORLD_HEIGHT, type Chunk } from '../../world/Chunk';
import { GamePacket } from './GamePacket';

const CHUNK_VOLUME = CHUNK_WIDTH * CHUNK_WIDTH * WORLD_HEIGHT;
const NIBBLE_VOLUME = CHUNK_VOLUME >> 1;

export class ChunkDataPacket extends GamePacket {
  constructor(public chunk?: Chunk) {
    super();
  }

  getId(): number {
    return 51;
  }

  getName(): string {
    return 'BlockRegionUpdate';
  }

  read(reader: BufferReader): void {
    throw new Error(`Incoming ${this.getName()} packets are unsupported (${reader.buffer.length} bytes)`);
  }

  write(writer: BufferWriter): void {
    if (!this.chunk) throw new Error('ChunkDataPacket requires a chunk');
    const compressed = encodeChunk(this.chunk);
    writer.writeByte(1)
      .writeInt(this.chunk.x * CHUNK_WIDTH)
      .writeShort(0)
      .writeInt(this.chunk.z * CHUNK_WIDTH)
      .writeByte(CHUNK_WIDTH - 1)
      .writeByte(WORLD_HEIGHT - 1)
      .writeByte(CHUNK_WIDTH - 1)
      .writeInt(compressed.length)
      .writeBytes(compressed);
  }
}

function encodeChunk(chunk: Chunk): Buffer {
  const blocks = Buffer.alloc(CHUNK_VOLUME);
  const metadata = Buffer.alloc(NIBBLE_VOLUME);
  const blockLight = Buffer.alloc(NIBBLE_VOLUME);
  const skyLight = Buffer.alloc(NIBBLE_VOLUME, 0xff);
  const biomes = Buffer.from(chunk.biomes);

  for (const [sectionY, section] of chunk.sections) {
    const blockOffset = sectionY * 16 * CHUNK_WIDTH * CHUNK_WIDTH;
    const nibbleOffset = sectionY * 16 * CHUNK_WIDTH * CHUNK_WIDTH / 2;
    Buffer.from(section.blocks).copy(blocks, blockOffset);
    Buffer.from(section.data).copy(metadata, nibbleOffset);
    if (section.blockLight) Buffer.from(section.blockLight).copy(blockLight, nibbleOffset);
    if (section.skyLight) Buffer.from(section.skyLight).copy(skyLight, nibbleOffset);
  }

  const reordered = Buffer.concat([blocks, metadata, blockLight, skyLight, biomes]);
  return deflateSync(encodeLegacyRle(reordered));
}

function encodeLegacyRle(input: Buffer): Buffer {
  const output: number[] = [];
  for (let offset = 0; offset < input.length;) {
    const value = input[offset];
    let runLength = 1;
    while (offset + runLength < input.length && input[offset + runLength] === value && runLength < 256) {
      runLength += 1;
    }
    if (runLength <= 3) {
      if (value === 0xff) output.push(0xff, runLength - 1);
      else for (let index = 0; index < runLength; index += 1) output.push(value);
    } else {
      output.push(0xff, runLength - 1, value);
    }
    offset += runLength;
  }
  return Buffer.from(output);
}
