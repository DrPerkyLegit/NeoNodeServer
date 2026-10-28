import { Entity } from './Entity';

export class EntityRegistry {
  private readonly entities = new Map<number, Entity>();
  private nextId = 1;

  allocateId(): number {
    while (this.entities.has(this.nextId)) {
      this.nextId += 1;
      if (!Number.isSafeInteger(this.nextId)) throw new Error('Entity ID space exhausted');
    }
    return this.nextId++;
  }

  add<T extends Entity>(entity: T): T {
    if (this.entities.has(entity.id)) throw new Error(`Entity ID ${entity.id} is already in use`);
    this.entities.set(entity.id, entity);
    if (entity.id >= this.nextId) this.nextId = entity.id + 1;
    return entity;
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  remove(id: number): Entity | undefined {
    const entity = this.entities.get(id);
    this.entities.delete(id);
    return entity;
  }

  values(): ReadonlyArray<Entity> {
    return [...this.entities.values()];
  }
}
