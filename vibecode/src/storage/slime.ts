import { BufferReader, BufferWriter } from '../binary';
import {
  CHUNK_SIZE,
  HALF_CHUNK_VOLUME,
  WORLD_HEIGHT,
  type Chunk,
} from '../world/chunk';
import type { SavedPlayer } from '../world/world';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const SLIME_MAGIC = 0xb10b;
const SLIME_VERSION = 10;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CHUNKS = 4096;

export interface SlimeWorldData {
  chunks: Chunk[];
  players: SavedPlayer[];
  seed: bigint;
}

export function saveSlimeWorld(world: SlimeWorldData): Buffer {
  if (world.chunks.length > MAX_CHUNKS) throw new RangeError(`Slime worlds are limited to ${MAX_CHUNKS} chunks`);
  const chunks = [...world.chunks].sort((a, b) => a.z - b.z || a.x - b.x);
  const minX = chunks.length ? Math.min(...chunks.map((chunk) => chunk.x)) : 0;
  const minZ = chunks.length ? Math.min(...chunks.map((chunk) => chunk.z)) : 0;
  const maxX = chunks.length ? Math.max(...chunks.map((chunk) => chunk.x)) : minX;
  const maxZ = chunks.length ? Math.max(...chunks.map((chunk) => chunk.z)) : minZ;
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  if (width > 0xffff || depth > 0xffff || width * depth > MAX_CHUNKS * 16) {
    throw new RangeError('Slime world bounds exceed supported limits');
  }
  if (minX < -0x8000 || minZ < -0x8000 || maxX > 0x7fff || maxZ > 0x7fff) {
    throw new RangeError('Slime chunk coordinates must fit signed 16-bit integers');
  }

  const chunksByPosition = new Map(chunks.map((chunk) => [`${chunk.x},${chunk.z}`, chunk]));
  const mask = Buffer.alloc(Math.ceil((width * depth) / 8));
  const packedChunks: Buffer[] = [];
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = z * width + x;
      const chunk = chunksByPosition.get(`${minX + x},${minZ + z}`);
      if (!chunk) continue;
      mask[position >> 3] |= 0x80 >> (position & 7);
      packedChunks.push(encodeSlimeChunk(chunk));
    }
  }

  const chunkData = Buffer.concat(packedChunks);
  const tiles = compressNbt(emptyListRoot('tiles'));
  const extra = compressNbt(worldExtra(world));
  const maps = compressNbt(emptyListRoot('maps'));
  const compressedChunks = zstdCompressSync(chunkData);

  const writer = new BufferWriter()
    .unsignedShort(SLIME_MAGIC)
    .byte(SLIME_VERSION)
    .short(minX)
    .short(minZ)
    .unsignedShort(width)
    .unsignedShort(depth)
    .bytes(mask)
    .int(compressedChunks.length)
    .int(chunkData.length)
    .bytes(compressedChunks)
    .int(tiles.length)
    .int(nbtUncompressedLength(tiles))
    .bytes(tiles)
    .bool(false)
    .int(extra.length)
    .int(nbtUncompressedLength(extra))
    .bytes(extra)
    .int(maps.length)
    .int(nbtUncompressedLength(maps))
    .bytes(maps)
    .build();

  if (writer.length > MAX_FILE_BYTES) throw new RangeError('Slime world exceeds maximum file size');
  return writer;
}

export function loadSlimeWorld(data: Buffer): SlimeWorldData {
  if (data.length > MAX_FILE_BYTES) throw new Error('Slime file exceeds maximum supported size');
  const reader = new BufferReader(data);
  if (reader.unsignedShort() !== SLIME_MAGIC) throw new Error('Invalid Slime file magic');
  const version = reader.byte();
  if (version !== SLIME_VERSION) throw new Error(`Unsupported Slime format version ${version}; expected ${SLIME_VERSION}`);
  const minX = reader.short();
  const minZ = reader.short();
  const width = reader.unsignedShort();
  const depth = reader.unsignedShort();
  const chunkCount = width * depth;
  if (!width || !depth || chunkCount > MAX_CHUNKS * 16) throw new Error('Invalid Slime world dimensions');
  const mask = reader.bytes(Math.ceil(chunkCount / 8));
  const present: Array<{ x: number; z: number }> = [];
  for (let index = 0; index < chunkCount; index += 1) {
    if ((mask[index >> 3] & (0x80 >> (index & 7))) !== 0) {
      present.push({ x: minX + (index % width), z: minZ + Math.floor(index / width) });
      if (present.length > MAX_CHUNKS) throw new Error(`Slime file contains more than ${MAX_CHUNKS} chunks`);
    }
  }

  const chunksCompressedLength = readLength(reader, 'compressed chunk data');
  const chunksUncompressedLength = readLength(reader, 'uncompressed chunk data');
  const chunksData = decompress(reader.bytes(chunksCompressedLength), chunksUncompressedLength, 'chunk data');
  const chunksReader = new BufferReader(chunksData);
  const chunks = present.map(({ x, z }) => decodeSlimeChunk(chunksReader, x, z));
  if (chunksReader.offset !== chunksData.length) throw new Error('Unexpected trailing bytes in Slime chunk data');

  const tileCompressedLength = readLength(reader, 'compressed tile entities');
  const tileUncompressedLength = readLength(reader, 'uncompressed tile entities');
  decompress(reader.bytes(tileCompressedLength), tileUncompressedLength, 'tile entities');

  if (reader.bool()) {
    const entityCompressedLength = readLength(reader, 'compressed entities');
    const entityUncompressedLength = readLength(reader, 'uncompressed entities');
    decompress(reader.bytes(entityCompressedLength), entityUncompressedLength, 'entities');
  }

  const extraCompressedLength = readLength(reader, 'compressed extra data');
  const extraUncompressedLength = readLength(reader, 'uncompressed extra data');
  const extra = decompress(reader.bytes(extraCompressedLength), extraUncompressedLength, 'extra data');
  const extraValues = readRootNbt(extra);

  const mapsCompressedLength = readLength(reader, 'compressed maps');
  const mapsUncompressedLength = readLength(reader, 'uncompressed maps');
  decompress(reader.bytes(mapsCompressedLength), mapsUncompressedLength, 'maps');
  if (reader.offset !== data.length) throw new Error('Unexpected trailing bytes in Slime file');

  return {
    chunks,
    players: parseSavedPlayers(extraValues.NeoLegacyPlayersJson),
    seed: typeof extraValues.NeoLegacySeed === 'bigint' ? extraValues.NeoLegacySeed : 0n,
  };
}

function encodeSlimeChunk(chunk: Chunk): Buffer {
  const heightmap = Buffer.alloc(256 * 4);
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      let height = 0;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
        if (chunk.blocks[y * 256 + z * 16 + x] !== 0) {
          height = y + 1;
          break;
        }
      }
      heightmap.writeInt32BE(height, (z * 16 + x) * 4);
    }
  }

  const sections: Buffer[] = [];
  let sectionMask = 0;
  for (let section = 0; section < 16; section += 1) {
    const blockOffset = section * 4096;
    const nibbleOffset = section * 2048;
    const blocks = chunk.blocks.subarray(blockOffset, blockOffset + 4096);
    const data = chunk.metadata.subarray(nibbleOffset, nibbleOffset + 2048);
    const blockLight = chunk.blockLight.subarray(nibbleOffset, nibbleOffset + 2048);
    const skyLight = chunk.skyLight.subarray(nibbleOffset, nibbleOffset + 2048);
    if (!containsNonZero(blocks) && !containsNonZero(data) && !containsNonZero(blockLight) && !containsNonZero(skyLight)) {
      continue;
    }
    sectionMask |= 1 << section;
    sections.push(
      Buffer.concat([
        Buffer.from([1]),
        blockLight,
        blocks,
        data,
        Buffer.from([1]),
        skyLight,
      ]),
    );
  }

  const mask = Buffer.allocUnsafe(2);
  mask.writeUInt16BE(sectionMask);
  return Buffer.concat([heightmap, chunk.biomes, mask, ...sections]);
}

function decodeSlimeChunk(reader: BufferReader, x: number, z: number): Chunk {
  const heightmap = reader.bytes(256 * 4);
  const biomes = Buffer.from(reader.bytes(256));
  const sectionMask = reader.unsignedShort();
  const blocks = Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  const metadata = Buffer.alloc(HALF_CHUNK_VOLUME);
  const blockLight = Buffer.alloc(HALF_CHUNK_VOLUME);
  const skyLight = Buffer.alloc(HALF_CHUNK_VOLUME);

  for (let section = 0; section < 16; section += 1) {
    if ((sectionMask & (1 << section)) === 0) continue;
    const hasBlockLight = reader.bool();
    const sectionBlockLight = hasBlockLight ? reader.bytes(2048) : undefined;
    const sectionBlocks = reader.bytes(4096);
    const sectionMetadata = reader.bytes(2048);
    const hasSkyLight = reader.bool();
    const sectionSkyLight = hasSkyLight ? reader.bytes(2048) : undefined;
    const blockOffset = section * 4096;
    const nibbleOffset = section * 2048;
    sectionBlocks.copy(blocks, blockOffset);
    sectionMetadata.copy(metadata, nibbleOffset);
    sectionBlockLight?.copy(blockLight, nibbleOffset);
    sectionSkyLight?.copy(skyLight, nibbleOffset);
  }

  void heightmap;
  return { x, z, blocks, metadata, blockLight, skyLight, biomes };
}

function containsNonZero(buffer: Buffer): boolean {
  return buffer.some((value) => value !== 0);
}

function emptyListRoot(name: string): Buffer {
  return new BufferWriter()
    .byte(10)
    .utf8('')
    .byte(9)
    .utf8(name)
    .byte(10)
    .int(0)
    .byte(0)
    .build();
}

function worldExtra(world: SlimeWorldData): Buffer {
  const players = JSON.stringify(world.players);
  const tagName = Buffer.from('NeoLegacyPlayersJson', 'utf8');
  const seedName = Buffer.from('NeoLegacySeed', 'utf8');
  return new BufferWriter()
    .byte(10)
    .utf8('')
    .byte(8)
    .utf8(tagName.toString('utf8'))
    .utf8(players)
    .byte(4)
    .utf8(seedName.toString('utf8'))
    .long(world.seed)
    .byte(0)
    .build();
}

function compressNbt(nbt: Buffer): Buffer {
  return zstdCompressSync(nbt);
}

function nbtUncompressedLength(compressedNbt: Buffer): number {
  return zstdDecompressSync(compressedNbt, { maxOutputLength: MAX_FILE_BYTES }).length;
}

function decompress(data: Buffer, expectedLength: number, label: string): Buffer {
  if (expectedLength > MAX_FILE_BYTES) throw new Error(`${label} exceeds maximum supported size`);
  const output = zstdDecompressSync(data, { maxOutputLength: Math.max(expectedLength, 1) });
  if (output.length !== expectedLength) {
    throw new Error(`${label} length mismatch: expected ${expectedLength}, got ${output.length}`);
  }
  return output;
}

function readLength(reader: BufferReader, label: string): number {
  const length = reader.int();
  if (length < 0 || length > MAX_FILE_BYTES) throw new Error(`Invalid ${label} length ${length}`);
  return length;
}

function readRootNbt(buffer: Buffer): Record<string, unknown> {
  const reader = new BufferReader(buffer);
  const rootType = reader.byte();
  if (rootType !== 10) throw new Error('Slime extra data must be an NBT compound');
  reader.utf8();
  const values: Record<string, unknown> = {};
  for (let tagCount = 0; tagCount < 100_000; tagCount += 1) {
    const type = reader.byte();
    if (type === 0) {
      if (reader.offset !== buffer.length) throw new Error('Unexpected trailing bytes in NBT compound');
      return values;
    }
    const name = reader.utf8();
    if (type === 4) values[name] = reader.long();
    else if (type === 8) values[name] = reader.utf8();
    else skipNbtPayload(reader, type, 0);
  }
  throw new Error('NBT compound contains too many tags or is missing an end tag');
}

function skipNbtPayload(reader: BufferReader, type: number, depth: number): void {
  if (depth > 64) throw new Error('NBT nesting depth exceeds safety limit');
  switch (type) {
    case 1:
      reader.bytes(1);
      return;
    case 2:
      reader.bytes(2);
      return;
    case 3:
    case 5:
      reader.bytes(4);
      return;
    case 4:
    case 6:
      reader.bytes(8);
      return;
    case 7:
    case 11:
    case 12: {
      const length = reader.int();
      const elementSize = type === 7 ? 1 : type === 11 ? 4 : 8;
      if (length < 0 || length * elementSize > MAX_FILE_BYTES) throw new Error('Invalid NBT array length');
      reader.bytes(length * elementSize);
      return;
    }
    case 8:
      reader.utf8();
      return;
    case 9: {
      const childType = reader.byte();
      const length = reader.int();
      if (length < 0 || length > 1_000_000) throw new Error('Invalid NBT list length');
      for (let i = 0; i < length; i += 1) skipNbtPayload(reader, childType, depth + 1);
      return;
    }
    case 10:
      for (let count = 0; count < 100_000; count += 1) {
        const childType = reader.byte();
        if (childType === 0) return;
        reader.utf8();
        skipNbtPayload(reader, childType, depth + 1);
      }
      throw new Error('NBT compound contains too many tags or is missing an end tag');
    default:
      throw new Error(`Unsupported NBT tag type ${type}`);
  }
}

function parseSavedPlayers(value: unknown): SavedPlayer[] {
  if (typeof value !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('Invalid saved player data in Slime extra compound', { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error('Saved player data must be an array');
  return parsed.map((candidate): SavedPlayer => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid saved player record');
    const player = candidate as Partial<SavedPlayer>;
    if (
      typeof player.name !== 'string' ||
      ![player.x, player.y, player.z, player.yaw, player.pitch].every((number) => typeof number === 'number' && Number.isFinite(number)) ||
      !Number.isInteger(player.selectedSlot) ||
      !Array.isArray(player.inventory)
    ) {
      throw new Error('Saved player record is missing valid fields');
    }
    return {
      name: player.name,
      x: player.x!,
      y: player.y!,
      z: player.z!,
      yaw: player.yaw!,
      pitch: player.pitch!,
      selectedSlot: player.selectedSlot!,
      inventory: player.inventory.map((stack) => {
        if (stack === null) return null;
        if (!stack || typeof stack !== 'object') throw new Error('Invalid saved inventory stack');
        const item = stack as Partial<NonNullable<SavedPlayer['inventory'][number]>>;
        if (![item.id, item.count, item.damage].every(Number.isInteger)) throw new Error('Invalid saved inventory stack');
        return { id: item.id!, count: item.count!, damage: item.damage! };
      }),
    };
  });
}
