import { deflateSync } from 'node:zlib';
import { BufferWriter } from '../binary';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const HALF_CHUNK_VOLUME = CHUNK_VOLUME / 2;
export const FLAT_SURFACE_Y = 3;
export const PLAINS_BIOME_ID = 1;

export interface Chunk {
  readonly x: number;
  readonly z: number;
  blocks: Buffer;
  metadata: Buffer;
  blockLight: Buffer;
  skyLight: Buffer;
  biomes: Buffer;
}

export function createFlatChunk(x: number, z: number): Chunk {
  const blocks = Buffer.alloc(CHUNK_VOLUME);
  for (let y = 0; y <= FLAT_SURFACE_Y; y += 1) {
    const blockId = y === 0 ? 7 : y === FLAT_SURFACE_Y ? 2 : 3;
    blocks.fill(blockId, y * CHUNK_SIZE * CHUNK_SIZE, (y + 1) * CHUNK_SIZE * CHUNK_SIZE);
  }
  return {
    x,
    z,
    blocks,
    metadata: Buffer.alloc(HALF_CHUNK_VOLUME),
    blockLight: Buffer.alloc(HALF_CHUNK_VOLUME),
    skyLight: Buffer.alloc(HALF_CHUNK_VOLUME, 0xff),
    biomes: Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE, PLAINS_BIOME_ID),
  };
}

export function getBlock(chunk: Chunk, worldX: number, y: number, worldZ: number): number {
  const localX = worldX - chunk.x * CHUNK_SIZE;
  const localZ = worldZ - chunk.z * CHUNK_SIZE;
  return chunk.blocks[y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX];
}

export function setBlock(chunk: Chunk, worldX: number, y: number, worldZ: number, blockId: number): void {
  const localX = worldX - chunk.x * CHUNK_SIZE;
  const localZ = worldZ - chunk.z * CHUNK_SIZE;
  chunk.blocks[y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX] = blockId;
}

export function blockCoordinates(x: number, z: number): { chunkX: number; chunkZ: number } {
  return { chunkX: Math.floor(x / CHUNK_SIZE), chunkZ: Math.floor(z / CHUNK_SIZE) };
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
      else for (let i = 0; i < runLength; i += 1) output.push(value);
    } else {
      output.push(0xff, runLength - 1, value);
    }
    offset += runLength;
  }
  return Buffer.from(output);
}

export function encodeChunkForClient(chunk: Chunk): Buffer {
  const reordered = Buffer.concat([chunk.blocks, chunk.metadata, chunk.blockLight, chunk.skyLight, chunk.biomes]);
  return deflateSync(encodeLegacyRle(reordered));
}

export function buildChunkPacket(chunk: Chunk, visible = true): Buffer {
  const compressed = encodeChunkForClient(chunk);
  const packets: Buffer[] = [];
  if (visible) {
    packets.push(new BufferWriter().byte(50).int(chunk.x).int(chunk.z).byte(1).build());
  }
  packets.push(
    new BufferWriter()
      .byte(51)
      .byte(1)
      .int(chunk.x * CHUNK_SIZE)
      .short(0)
      .int(chunk.z * CHUNK_SIZE)
      .byte(CHUNK_SIZE - 1)
      .byte(WORLD_HEIGHT - 1)
      .byte(CHUNK_SIZE - 1)
      .int(compressed.length)
      .bytes(compressed)
      .build(),
  );
  return Buffer.concat(packets);
}

export function buildTileUpdatePacket(x: number, y: number, z: number, blockId: number, metadata = 0): Buffer {
  return new BufferWriter()
    .byte(53)
    .int(x)
    .byte(y)
    .int(z)
    .short(blockId)
    .byte(metadata & 0x0f)
    .build();
}

export function getMetadata(chunk: Chunk, worldX: number, y: number, worldZ: number): number {
  const localX = worldX - chunk.x * CHUNK_SIZE;
  const localZ = worldZ - chunk.z * CHUNK_SIZE;
  const index = y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX;
  return (chunk.metadata[index >> 1] >> ((index & 1) * 4)) & 0x0f;
}
