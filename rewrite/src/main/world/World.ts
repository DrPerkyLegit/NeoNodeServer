import type { SlimeAuxiliaryData } from '../storage/SlimeWorldStorage';
import { createEmptyAuxiliaryData, SlimeWorldStorage } from '../storage/SlimeWorldStorage';
import { Chunk, isWorldPositionValid } from './Chunk';
import type { WorldGenerator } from './generators/FlatWorldGenerator';
import type { Entity } from '../entities/Entity';
import { ItemEntity } from '../entities/ItemEntity';

export interface WorldOptions {
  readonly name: string;
  readonly filePath: string;
  readonly seed: bigint;
  readonly generator: WorldGenerator;
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly entities = new Map<number, Entity>();
  readonly itemEntities = new Map<number, ItemEntity>();
  readonly name: string;
  readonly filePath: string;
  readonly generator: WorldGenerator;
  seed: bigint;
  private auxiliary: SlimeAuxiliaryData = createEmptyAuxiliaryData();
  private saveInProgress: Promise<void> | undefined;

  private constructor(options: WorldOptions) {
    this.name = options.name;
    this.filePath = options.filePath;
    this.seed = options.seed;
    this.generator = options.generator;
  }

  static async load(options: WorldOptions): Promise<World> {
    const world = new World(options);
    const saved = await SlimeWorldStorage.load(options.filePath);
    for (const chunk of saved.chunks) {
      const key = chunkKey(chunk.x, chunk.z);
      if (world.chunks.has(key)) throw new Error(`Slime world contains duplicate chunk ${key}`);
      world.chunks.set(key, chunk);
    }
    world.auxiliary = saved.auxiliary;
    return world;
  }

  getChunk(x: number, z: number): Chunk {
    if (!Number.isInteger(x) || !Number.isInteger(z)) throw new RangeError('Chunk coordinates must be integers');
    const key = chunkKey(x, z);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generator.generate(x, z, this.seed);
      if (chunk.x !== x || chunk.z !== z) {
        throw new Error(`Generator "${this.generator.name}" returned chunk (${chunk.x},${chunk.z}) for (${x},${z})`);
      }
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  getBlock(x: number, y: number, z: number): number {
    if (!isWorldPositionValid(x, y, z)) return 0;
    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    return this.getChunk(chunkX, chunkZ).getBlock(x, y, z);
  }

  setBlock(x: number, y: number, z: number, blockId: number, metadata = 0): void {
    if (!isWorldPositionValid(x, y, z)) throw new RangeError(`Block position is outside the world: ${x},${y},${z}`);
    const chunkX = Math.floor(x / 16);
    const chunkZ = Math.floor(z / 16);
    this.getChunk(chunkX, chunkZ).setBlock(x, y, z, blockId, metadata);
  }

  addEntity<T extends Entity>(entity: T): T {
    if (this.entities.has(entity.id)) throw new Error(`Entity ${entity.id} already exists in world "${this.name}"`);
    this.entities.set(entity.id, entity);
    if (entity instanceof ItemEntity) this.itemEntities.set(entity.id, entity);
    return entity;
  }

  removeEntity(entityId: number): Entity | undefined {
    const entity = this.entities.get(entityId);
    this.entities.delete(entityId);
    this.itemEntities.delete(entityId);
    return entity;
  }

  async save(): Promise<void> {
    if (this.saveInProgress) {
      await this.saveInProgress;
      return this.save();
    }
    if (this.chunks.size === 0) this.getChunk(0, 0);
    this.saveInProgress = SlimeWorldStorage.save(this.filePath, [...this.chunks.values()], this.auxiliary);
    try {
      await this.saveInProgress;
    } finally {
      this.saveInProgress = undefined;
    }
  }
}

function chunkKey(x: number, z: number): string {
  return `${x},${z}`;
}
