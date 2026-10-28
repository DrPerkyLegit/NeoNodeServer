import path from 'node:path';
import { Logger } from '../utils/Logger';
import { ServerProperties } from '../config/ServerProperties';
import { SlimeWorldStorage } from '../storage/SlimeWorldStorage';
import { BlockRegistry } from '../blocks/Block';
import { WorldInteractionService } from '../blocks/WorldInteractionService';
import { EntityRegistry } from '../entities/EntityRegistry';
import { ItemRegistry } from '../items/Item';
import { FlatWorldGenerator } from '../world/generators/FlatWorldGenerator';
import { World } from '../world/World';
import { WorldManager } from '../world/WorldManager';
import { TickRateMonitor } from './TickRateMonitor';

export class WorldServer {
  private readonly tickRate = new TickRateMonitor();

  private constructor(
    public readonly properties: ServerProperties,
    public readonly worlds: WorldManager,
    public readonly blocks: BlockRegistry,
    public readonly items: ItemRegistry,
    public readonly entities: EntityRegistry,
    public readonly interactions: WorldInteractionService,
  ) {}

  static async load(propertiesFile = path.join(process.cwd(), 'server.properties')): Promise<WorldServer> {
    Logger.info('Loading server.properties');
    const properties = await ServerProperties.load(propertiesFile);
    Logger.info(`Loading world "${properties.worldName}"`);

    const world = await World.load({
      name: properties.worldName,
      filePath: properties.getWorldFilePath(),
      seed: properties.seed,
      generator: new FlatWorldGenerator(),
    });
    const wasSaved = world.chunks.size > 0;
    world.getChunk(0, 0);

    const worlds = new WorldManager();
    worlds.add(world);
    const blocks = new BlockRegistry();
    blocks.register({ id: 1, name: 'stone', dropItemId: 1 });
    blocks.register({ id: 2, name: 'grass', dropItemId: 3 });
    blocks.register({ id: 3, name: 'dirt', dropItemId: 3 });
    blocks.register({ id: 7, name: 'bedrock', unbreakable: true });
    const items = new ItemRegistry();
    items.register({ id: 1, name: 'stone', maxStackSize: 64, maxDamage: 0 });
    items.register({ id: 2, name: 'grass', maxStackSize: 64, maxDamage: 0 });
    items.register({ id: 3, name: 'dirt', maxStackSize: 64, maxDamage: 0 });
    items.register({ id: 7, name: 'bedrock', maxStackSize: 64, maxDamage: 0 });
    const entities = new EntityRegistry();
    const interactions = new WorldInteractionService(blocks, items, entities);
    Logger.info(
      `World ready: ${world.name} (${properties.worldType}), ` +
      `${wasSaved ? 'loaded' : 'created'} ${world.chunks.size} chunk(s)`,
    );
    return new WorldServer(properties, worlds, blocks, items, entities, interactions);
  }

  async save(): Promise<void> {
    Logger.info('Saving loaded worlds');
    await this.worlds.saveAll();
    Logger.success('World save complete');
  }

  tick(): void {
    const tickStartedAt = performance.now();
    for (const world of this.worlds.values()) {
      for (const item of world.itemEntities.values()) item.tick();
    }
    this.tickRate.recordTick(tickStartedAt);
  }

  get tps(): number {
    return this.tickRate.getTps();
  }
}
