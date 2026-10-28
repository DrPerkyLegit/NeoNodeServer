import { createFlatChunk, type Chunk } from '../world/chunk';

export interface WorldGenerationContext {
  readonly worldName: string;
  readonly dimension: -1 | 0 | 1;
  readonly seed: bigint;
}

export type ChunkGenerator = (chunkX: number, chunkZ: number, context: WorldGenerationContext) => Chunk;

export class WorldGeneratorRegistry {
  private readonly generators = new Map<string, ChunkGenerator>();
  private sealed = false;

  constructor() {
    this.register('flat', (chunkX, chunkZ) => createFlatChunk(chunkX, chunkZ));
  }

  register(name: string, generator: ChunkGenerator): void {
    if (this.sealed) throw new Error('World generator registry is sealed; register generators during plugin initialization');
    const normalizedName = name.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(normalizedName)) {
      throw new Error(`Invalid world generator name: ${name}`);
    }
    if (this.generators.has(normalizedName)) throw new Error(`World generator is already registered: ${normalizedName}`);
    if (typeof generator !== 'function') throw new TypeError('World generator must be a function');
    this.generators.set(normalizedName, generator);
  }

  get(name: string): ChunkGenerator | undefined {
    return this.generators.get(name.trim().toLowerCase());
  }

  names(): string[] {
    return [...this.generators.keys()];
  }

  seal(): void {
    this.sealed = true;
  }
}
