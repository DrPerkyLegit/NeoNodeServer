import { World } from './World';

export class WorldManager {
  private readonly worldsByName = new Map<string, World>();

  add(world: World): void {
    const key = world.name.toLowerCase();
    if (this.worldsByName.has(key)) throw new Error(`World name is already loaded: ${world.name}`);
    this.worldsByName.set(key, world);
  }

  get(name: string): World | undefined {
    return this.worldsByName.get(name.toLowerCase());
  }

  values(): ReadonlyArray<World> {
    return [...this.worldsByName.values()];
  }

  async saveAll(): Promise<void> {
    await Promise.all(this.values().map((world) => world.save()));
  }
}
