import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { BufferReader } from '../network/buffers/BufferReader';
import { BufferWriter } from '../network/buffers/BufferWriter';
import { Chunk, type ChunkSection } from '../world/Chunk';

const SLIME_MAGIC = 0xb10b;
const SLIME_VERSION = 10;
const MAX_REGION_CHUNKS = 1_000_000;
const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export interface SlimeAuxiliaryData {
  readonly tiles: CompressedData;
  readonly entities?: CompressedData;
  readonly extra: CompressedData;
  readonly maps: CompressedData;
}

export interface CompressedData {
  readonly compressed: Buffer;
  readonly uncompressedSize: number;
}

export interface SlimeWorldData {
  readonly chunks: Chunk[];
  readonly auxiliary: SlimeAuxiliaryData;
}

export class SlimeWorldStorage {
  static async load(filePath: string): Promise<SlimeWorldData> {
    const data = await readFile(filePath).catch((error: unknown) => {
      if (isMissingFile(error)) return undefined;
      throw new Error(`Unable to read Slime world "${filePath}": ${errorMessage(error)}`, { cause: error });
    });
    return data ? decodeSlimeWorld(data, filePath) : { chunks: [], auxiliary: createEmptyAuxiliaryData() };
  }

  static async save(filePath: string, chunks: readonly Chunk[], auxiliary: SlimeAuxiliaryData): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, encodeSlimeWorld(chunks, auxiliary));
      await rename(temporaryPath, filePath);
    } catch (error) {
      let cleanupError: unknown;
      await unlink(temporaryPath).catch((caught: unknown) => {
        if (!isMissingFile(caught)) cleanupError = caught;
      });
      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Unable to save Slime world "${filePath}" or remove its temporary file: ` +
          `${errorMessage(error)}; ${errorMessage(cleanupError)}`,
        );
      }
      throw new Error(`Unable to save Slime world "${filePath}": ${errorMessage(error)}`, { cause: error });
    }
  }
}

export function createEmptyAuxiliaryData(): SlimeAuxiliaryData {
  return {
    tiles: compressNbt(emptyNamedCompoundList('tiles')),
    extra: compressNbt(emptyCompound()),
    maps: compressNbt(emptyNamedCompoundList('maps')),
  };
}

function decodeSlimeWorld(file: Buffer, filePath: string): SlimeWorldData {
  try {
    const reader = new BufferReader(file);
    if (reader.readUShort() !== SLIME_MAGIC) throw new Error('Invalid Slime magic header');
    const version = reader.readByte();
    if (version !== SLIME_VERSION) throw new Error(`Unsupported Slime version ${version}; expected ${SLIME_VERSION}`);
    const minChunkX = reader.readShort();
    const minChunkZ = reader.readShort();
    const width = reader.readUShort();
    const depth = reader.readUShort();
    const regionSize = width * depth;
    if (width === 0 || depth === 0 || regionSize > MAX_REGION_CHUNKS) {
      throw new Error(`Invalid Slime region dimensions ${width}x${depth}`);
    }

    const mask = reader.readBytes(Math.ceil(regionSize / 8));
    const compressedChunks = readCompressedData(reader, 'chunks');
    const chunkBytes = decompress(compressedChunks, 'chunks');
    const chunks: Chunk[] = [];
    const chunkReader = new BufferReader(chunkBytes);
    for (let index = 0; index < regionSize; index += 1) {
      if (!bitIsSet(mask, index)) continue;
      const localX = index % width;
      const localZ = Math.floor(index / width);
      chunks.push(readChunk(chunkReader, minChunkX + localX, minChunkZ + localZ));
    }
    if (chunkReader.offset !== chunkBytes.length) throw new Error('Unexpected trailing bytes in Slime chunk data');

    const tiles = readCompressedData(reader, 'tile entities');
    decompress(tiles, 'tile entities');
    const hasEntities = reader.readByte();
    if (hasEntities !== 0 && hasEntities !== 1) throw new Error(`Invalid Slime entities flag: ${hasEntities}`);
    let entities: CompressedData | undefined;
    if (hasEntities) {
      entities = readCompressedData(reader, 'entities');
      decompress(entities, 'entities');
    }
    const extra = readCompressedData(reader, 'extra data');
    decompress(extra, 'extra data');
    const maps = readCompressedData(reader, 'maps');
    decompress(maps, 'maps');
    if (reader.offset !== file.length) throw new Error('Unexpected trailing data after Slime world');

    return { chunks, auxiliary: { tiles, entities, extra, maps } };
  } catch (error) {
    throw new Error(`Unable to parse Slime world "${filePath}": ${errorMessage(error)}`, { cause: error });
  }
}

function encodeSlimeWorld(chunks: readonly Chunk[], auxiliary: SlimeAuxiliaryData): Buffer {
  const region = getRegion(chunks);
  const chunkWriter = new BufferWriter();
  const bitmask = Buffer.alloc(Math.ceil((region.width * region.depth) / 8));
  const indexedChunks = new Map<string, Chunk>();
  for (const chunk of chunks) {
    const key = chunkKey(chunk.x, chunk.z);
    if (indexedChunks.has(key)) throw new Error(`Duplicate chunk coordinates: ${key}`);
    indexedChunks.set(key, chunk);
  }

  for (let localZ = 0; localZ < region.depth; localZ += 1) {
    for (let localX = 0; localX < region.width; localX += 1) {
      const index = localZ * region.width + localX;
      const chunk = indexedChunks.get(chunkKey(region.minX + localX, region.minZ + localZ));
      if (!chunk) continue;
      bitmask[index >> 3] |= 1 << (7 - (index & 7));
      writeChunk(chunkWriter, chunk);
    }
  }
  const chunkData = chunkWriter.build();
  const compressedChunks = compress(zstdCompressSync(chunkData), chunkData.length, 'chunks');

  const writer = new BufferWriter()
    .writeUShort(SLIME_MAGIC)
    .writeByte(SLIME_VERSION)
    .writeShort(region.minX)
    .writeShort(region.minZ)
    .writeUShort(region.width)
    .writeUShort(region.depth)
    .writeBytes(bitmask);
  writeCompressedData(writer, compressedChunks);
  writeCompressedData(writer, auxiliary.tiles);
  writer.writeByte(auxiliary.entities ? 1 : 0);
  if (auxiliary.entities) writeCompressedData(writer, auxiliary.entities);
  writeCompressedData(writer, auxiliary.extra);
  writeCompressedData(writer, auxiliary.maps);
  return writer.build();
}

function readChunk(reader: BufferReader, x: number, z: number): Chunk {
  const chunk = new Chunk(x, z);
  for (let index = 0; index < 256; index += 1) chunk.heightMap[index] = reader.readInt();
  reader.readBytes(256).copy(chunk.biomes);
  const sectionMask = reader.readUShort();
  for (let sectionY = 0; sectionY < 16; sectionY += 1) {
    if ((sectionMask & (1 << sectionY)) === 0) continue;
    const hasBlockLight = readBoolean(reader, 'block light');
    const blockLight = hasBlockLight ? Uint8Array.from(reader.readBytes(2048)) : undefined;
    const blocks = Uint8Array.from(reader.readBytes(4096));
    const sectionData = Uint8Array.from(reader.readBytes(2048));
    const hasSkyLight = readBoolean(reader, 'sky light');
    const skyLight = hasSkyLight ? Uint8Array.from(reader.readBytes(2048)) : undefined;
    const section: ChunkSection = { blocks, data: sectionData, blockLight, skyLight };
    chunk.sections.set(sectionY, section);
  }
  return chunk;
}

function writeChunk(writer: BufferWriter, chunk: Chunk): void {
  if (chunk.heightMap.length !== 256 || chunk.biomes.length !== 256) {
    throw new Error(`Chunk (${chunk.x},${chunk.z}) has invalid heightmap or biome data`);
  }
  for (const height of chunk.heightMap) writer.writeInt(height);
  writer.writeBytes(Buffer.from(chunk.biomes));
  let sectionMask = 0;
  for (const sectionY of chunk.sections.keys()) {
    if (!Number.isInteger(sectionY) || sectionY < 0 || sectionY > 15) {
      throw new Error(`Chunk (${chunk.x},${chunk.z}) has invalid section Y ${sectionY}`);
    }
    sectionMask |= 1 << sectionY;
  }
  writer.writeUShort(sectionMask);

  for (let sectionY = 0; sectionY < 16; sectionY += 1) {
    const section = chunk.sections.get(sectionY);
    if (!section) continue;
    validateSection(chunk, sectionY, section);
    writer.writeBool(Boolean(section.blockLight));
    if (section.blockLight) writer.writeBytes(Buffer.from(section.blockLight));
    writer.writeBytes(Buffer.from(section.blocks));
    writer.writeBytes(Buffer.from(section.data));
    writer.writeBool(Boolean(section.skyLight));
    if (section.skyLight) writer.writeBytes(Buffer.from(section.skyLight));
  }
}

function validateSection(chunk: Chunk, sectionY: number, section: ChunkSection): void {
  if (section.blocks.length !== 4096 || section.data.length !== 2048) {
    throw new Error(`Chunk (${chunk.x},${chunk.z}) section ${sectionY} has invalid block data size`);
  }
  if (section.blockLight && section.blockLight.length !== 2048) {
    throw new Error(`Chunk (${chunk.x},${chunk.z}) section ${sectionY} has invalid block-light size`);
  }
  if (section.skyLight && section.skyLight.length !== 2048) {
    throw new Error(`Chunk (${chunk.x},${chunk.z}) section ${sectionY} has invalid sky-light size`);
  }
}

function getRegion(chunks: readonly Chunk[]): { minX: number; minZ: number; width: number; depth: number } {
  if (chunks.length === 0) throw new Error('Cannot save a Slime world with no generated chunks');
  const coordinates = new Set<string>();
  let minX = Number.MAX_SAFE_INTEGER;
  let minZ = Number.MAX_SAFE_INTEGER;
  let maxX = Number.MIN_SAFE_INTEGER;
  let maxZ = Number.MIN_SAFE_INTEGER;
  for (const chunk of chunks) {
    if (!Number.isInteger(chunk.x) || !Number.isInteger(chunk.z)) {
      throw new Error(`Invalid chunk coordinates: ${chunk.x},${chunk.z}`);
    }
    const key = chunkKey(chunk.x, chunk.z);
    if (coordinates.has(key)) throw new Error(`Duplicate chunk coordinates: ${key}`);
    coordinates.add(key);
    minX = Math.min(minX, chunk.x);
    minZ = Math.min(minZ, chunk.z);
    maxX = Math.max(maxX, chunk.x);
    maxZ = Math.max(maxZ, chunk.z);
  }
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  if (
    minX < -32768 || minX > 32767 || minZ < -32768 || minZ > 32767 ||
    width > 65535 || depth > 65535 || width * depth > MAX_REGION_CHUNKS
  ) {
    throw new RangeError(`Slime chunk region is too large to serialize: origin=${minX},${minZ}, size=${width}x${depth}`);
  }
  return { minX, minZ, width, depth };
}

function readCompressedData(reader: BufferReader, label: string): CompressedData {
  const compressedSize = reader.readInt();
  const uncompressedSize = reader.readInt();
  if (compressedSize < 0 || compressedSize > MAX_COMPRESSED_BYTES) {
    throw new Error(`Invalid compressed ${label} size ${compressedSize}`);
  }
  if (uncompressedSize < 0 || uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`Invalid uncompressed ${label} size ${uncompressedSize}`);
  }
  return { compressed: Buffer.from(reader.readBytes(compressedSize)), uncompressedSize };
}

function decompress(data: CompressedData, label: string): Buffer {
  let result: Buffer;
  try {
    result = zstdDecompressSync(data.compressed);
  } catch (error) {
    throw new Error(`Unable to decompress Slime ${label}: ${errorMessage(error)}`, { cause: error });
  }
  if (result.length !== data.uncompressedSize) {
    throw new Error(`Slime ${label} size mismatch: declared ${data.uncompressedSize}, decoded ${result.length}`);
  }
  return result;
}

function compress(compressed: Buffer, uncompressedSize: number, label: string): CompressedData {
  if (compressed.length > MAX_COMPRESSED_BYTES || uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    throw new RangeError(`Slime ${label} exceeds supported size limits`);
  }
  return { compressed, uncompressedSize };
}

function compressNbt(data: Buffer): CompressedData {
  return { compressed: zstdCompressSync(data), uncompressedSize: data.length };
}

function writeCompressedData(writer: BufferWriter, data: CompressedData): void {
  writer.writeInt(data.compressed.length).writeInt(data.uncompressedSize).writeBytes(data.compressed);
}

function emptyCompound(): Buffer {
  return Buffer.from([10, 0, 0, 0]);
}

function emptyNamedCompoundList(name: string): Buffer {
  return new BufferWriter()
    .writeByte(10)
    .writeStringUTF8('')
    .writeByte(9)
    .writeStringUTF8(name)
    .writeByte(10)
    .writeInt(0)
    .writeByte(0)
    .build();
}

function readBoolean(reader: BufferReader, label: string): boolean {
  const value = reader.readByte();
  if (value !== 0 && value !== 1) throw new Error(`Invalid Slime ${label} flag ${value}`);
  return value === 1;
}

function bitIsSet(mask: Buffer, index: number): boolean {
  return (mask[index >> 3] & (1 << (7 - (index & 7)))) !== 0;
}

function chunkKey(x: number, z: number): string {
  return `${x},${z}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
