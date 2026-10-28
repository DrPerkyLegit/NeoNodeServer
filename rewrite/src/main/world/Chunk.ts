export const CHUNK_WIDTH = 16;
export const WORLD_HEIGHT = 256;
export const SECTION_HEIGHT = 16;
export const BLOCKS_PER_SECTION = CHUNK_WIDTH * CHUNK_WIDTH * SECTION_HEIGHT;

export interface ChunkSection {
  readonly blocks: Uint8Array;
  readonly data: Uint8Array;
  readonly blockLight?: Uint8Array;
  readonly skyLight?: Uint8Array;
}

export class Chunk {
  readonly heightMap = new Int32Array(CHUNK_WIDTH * CHUNK_WIDTH);
  readonly biomes = new Uint8Array(CHUNK_WIDTH * CHUNK_WIDTH);
  readonly sections = new Map<number, ChunkSection>();

  constructor(
    public readonly x: number,
    public readonly z: number,
  ) {}

  getBlock(x: number, y: number, z: number): number {
    if (!isWorldPositionValid(x, y, z)) return 0;
    const section = this.sections.get(y >> 4);
    if (!section) return 0;
    return section.blocks[sectionBlockIndex(x & 15, y & 15, z & 15)];
  }

  setBlock(x: number, y: number, z: number, blockId: number, metadata = 0): void {
    if (!isWorldPositionValid(x, y, z)) throw new RangeError(`Block position is outside the world: ${x},${y},${z}`);
    if (!Number.isInteger(blockId) || blockId < 0 || blockId > 255) {
      throw new RangeError(`Block ID must be an integer from 0 to 255: ${blockId}`);
    }
    if (!Number.isInteger(metadata) || metadata < 0 || metadata > 15) {
      throw new RangeError(`Block metadata must be an integer from 0 to 15: ${metadata}`);
    }

    const sectionY = y >> 4;
    let section = this.sections.get(sectionY);
    if (!section) {
      section = { blocks: new Uint8Array(BLOCKS_PER_SECTION), data: new Uint8Array(BLOCKS_PER_SECTION >> 1) };
      this.sections.set(sectionY, section);
    }

    const index = sectionBlockIndex(x & 15, y & 15, z & 15);
    section.blocks[index] = blockId;
    const metadataIndex = index >> 1;
    const existing = section.data[metadataIndex];
    section.data[metadataIndex] = index & 1
      ? (existing & 0x0f) | (metadata << 4)
      : (existing & 0xf0) | metadata;
    const columnIndex = (z & 15) * CHUNK_WIDTH + (x & 15);
    if (blockId !== 0) {
      this.heightMap[columnIndex] = Math.max(this.heightMap[columnIndex], y + 1);
    } else if (this.heightMap[columnIndex] === y + 1) {
      let height = y;
      while (height > 0 && this.getBlock(x, height - 1, z) === 0) height -= 1;
      this.heightMap[columnIndex] = height;
    }
  }
}

export function sectionBlockIndex(x: number, y: number, z: number): number {
  return y * CHUNK_WIDTH * CHUNK_WIDTH + z * CHUNK_WIDTH + x;
}

export function isWorldPositionValid(x: number, y: number, z: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    y >= 0 && y < WORLD_HEIGHT && Math.abs(x) <= 30_000_000 && Math.abs(z) <= 30_000_000;
}
