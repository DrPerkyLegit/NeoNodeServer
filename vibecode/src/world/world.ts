import { dirname, join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { Chunk } from './chunk';
import { createFlatChunk } from './chunk';
import { loadSlimeWorld, saveSlimeWorld } from '../storage/slime';
import type { ChunkGenerator, WorldGenerationContext } from '../server/world-generators';

export interface InventoryStack {
  id: number;
  count: number;
  damage: number;
}

export interface SavedPlayer {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  selectedSlot: number;
  inventory: Array<InventoryStack | null>;
}

export interface WorldOptions {
  name?: string;
  dimension?: -1 | 0 | 1;
  filePath?: string;
  seed?: bigint;
  generator?: string;
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly players = new Map<string, SavedPlayer>();
  readonly name: string;
  readonly dimension: -1 | 0 | 1;
  readonly filePath: string;
  readonly generatorName: string;
  seed: bigint;

  private saveTimer: NodeJS.Timeout | undefined;
  private saveInProgress: Promise<void> | undefined;
  private chunkGenerator: ChunkGenerator = (x, z) => createFlatChunk(x, z);

  private constructor(name: string, dimension: -1 | 0 | 1, filePath: string, seed: bigint, generatorName: string) {
    this.name = name;
    this.dimension = dimension;
    this.filePath = filePath;
    this.seed = seed;
    this.generatorName = generatorName;
  }

  static async load(options: WorldOptions = {}): Promise<World> {
    const filePath = options.filePath ?? join(process.cwd(), 'worlds', 'flat.slime');
    const generatorName = options.generator?.trim().toLowerCase() || 'flat';
    const world = new World(options.name ?? 'overworld', options.dimension ?? 0, filePath, options.seed ?? 0n, generatorName);
    try {
      const data = await readFile(filePath);
      const loaded = loadSlimeWorld(data);
      world.seed = loaded.seed;
      for (const chunk of loaded.chunks) world.chunks.set(chunkKey(chunk.x, chunk.z), chunk);
      for (const player of loaded.players) world.players.set(player.name.toLowerCase(), player);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Unable to load Slime world "${filePath}": ${(error as Error).message}`, { cause: error });
      }
    }
    return world;
  }

  getChunk(x: number, z: number): Chunk {
    const key = chunkKey(x, z);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.chunkGenerator(x, z, this.generationContext());
      validateGeneratedChunk(chunk, x, z);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  setChunkGenerator(generator: ChunkGenerator): void {
    this.chunkGenerator = generator;
  }

  setPlayer(player: SavedPlayer): void {
    this.players.set(player.name.toLowerCase(), clonePlayer(player));
  }

  scheduleSave(onError: (error: Error) => void): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save().catch((error: unknown) => onError(error as Error));
    }, 750);
    this.saveTimer.unref();
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.saveInProgress) {
      await this.saveInProgress;
      return this.save();
    }
    this.saveInProgress = this.writeWorld();
    try {
      await this.saveInProgress;
    } finally {
      this.saveInProgress = undefined;
    }
  }

  private async writeWorld(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const data = saveSlimeWorld({
      chunks: [...this.chunks.values()],
      seed: this.seed,
      players: [...this.players.values()],
    });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, data);
    await rename(tempPath, this.filePath);
  }

  private generationContext(): WorldGenerationContext {
    return Object.freeze({
      worldName: this.name,
      dimension: this.dimension,
      seed: this.seed,
    });
  }
}

function chunkKey(x: number, z: number): string {
  return `${x},${z}`;
}

function clonePlayer(player: SavedPlayer): SavedPlayer {
  return {
    ...player,
    inventory: player.inventory.map((stack) => (stack ? { ...stack } : null)),
  };
}

function validateGeneratedChunk(chunk: Chunk, x: number, z: number): void {
  if (!chunk || chunk.x !== x || chunk.z !== z) {
    throw new Error(`Chunk generator returned incorrect coordinates for (${x}, ${z})`);
  }
  const expectedBuffers = [
    ['blocks', chunk.blocks, 16 * 16 * 256],
    ['metadata', chunk.metadata, 16 * 16 * 256 / 2],
    ['blockLight', chunk.blockLight, 16 * 16 * 256 / 2],
    ['skyLight', chunk.skyLight, 16 * 16 * 256 / 2],
    ['biomes', chunk.biomes, 16 * 16],
  ] as const;
  for (const [name, buffer, expectedLength] of expectedBuffers) {
    if (!Buffer.isBuffer(buffer) || buffer.length !== expectedLength) {
      throw new Error(`Chunk generator returned invalid ${name} data for (${x}, ${z})`);
    }
  }
}
