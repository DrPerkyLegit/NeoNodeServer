import { resolve } from 'node:path';
import type { World } from './world';

export class WorldManager {
  private readonly worlds = new Map<string, World>();

  constructor(worlds: Iterable<World>) {
    const filePaths = new Set<string>();
    for (const world of worlds) {
      const key = normalizeName(world.name);
      if (!key || world.name.length > 16) throw new Error('World names must be 1-16 characters');
      if (![-1, 0, 1].includes(world.dimension)) throw new Error(`Unsupported world dimension: ${world.dimension}`);
      if (this.worlds.has(key)) throw new Error(`Duplicate world name: ${world.name}`);
      const filePath = resolve(world.filePath).toLowerCase();
      if (filePaths.has(filePath)) throw new Error(`Worlds cannot share the same Slime file: ${world.filePath}`);
      filePaths.add(filePath);
      this.worlds.set(key, world);
    }
    if (this.worlds.size === 0) throw new Error('At least one world must be configured');
  }

  get(name: string): World | undefined {
    return this.worlds.get(normalizeName(name));
  }

  first(): World {
    const first = this.worlds.values().next();
    if (first.done) throw new Error('At least one world must be configured');
    return first.value;
  }

  all(): ReadonlyArray<World> {
    return [...this.worlds.values()];
  }

  names(): string[] {
    return [...this.worlds.values()].map((world) => world.name);
  }

  transitionBridgeWorld(source: World, target: World): World | undefined {
    if (source.dimension !== 0 || target.dimension !== 0) return undefined;
    return this.all().find((world) => world.dimension === -1 && world !== source && world !== target);
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
