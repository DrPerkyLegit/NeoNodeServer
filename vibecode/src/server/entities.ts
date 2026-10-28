import type { InventoryStack, World } from '../world/world';

export interface ItemEntity {
  readonly id: number;
  readonly kind: 'item';
  readonly world: World;
  readonly item: Readonly<InventoryStack>;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly createdAt: number;
  readonly pickupAfter: number;
  readonly expiresAt: number;
}

export type ServerEntity = ItemEntity;

export interface EntityRegistryView {
  readonly size: number;
  get(id: number): Readonly<ServerEntity> | undefined;
  values(): ReadonlyArray<Readonly<ServerEntity>>;
  inWorld(world: World): ReadonlyArray<Readonly<ServerEntity>>;
}

export class EntityRegistry implements EntityRegistryView {
  private readonly entities = new Map<number, Readonly<ServerEntity>>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Entity registry capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.entities.size;
  }

  get(id: number): Readonly<ServerEntity> | undefined {
    return this.entities.get(id);
  }

  values(): ReadonlyArray<Readonly<ServerEntity>> {
    return [...this.entities.values()];
  }

  inWorld(world: World): ReadonlyArray<Readonly<ServerEntity>> {
    return this.values().filter((entity) => entity.world === world);
  }

  register<T extends ServerEntity>(entity: T): Readonly<T> {
    if (!Number.isSafeInteger(entity.id) || entity.id < 1) {
      throw new RangeError(`Invalid entity ID: ${entity.id}`);
    }
    if (this.entities.has(entity.id)) throw new Error(`Entity ID is already registered: ${entity.id}`);
    if (this.entities.size >= this.capacity) throw new RangeError('Entity registry capacity reached');
    const frozen = Object.freeze({
      ...entity,
      position: Object.freeze({ ...entity.position }),
      item: Object.freeze({ ...entity.item }),
    }) as Readonly<T>;
    this.entities.set(entity.id, frozen);
    return frozen;
  }

  remove(id: number): Readonly<ServerEntity> | undefined {
    const entity = this.entities.get(id);
    if (entity) this.entities.delete(id);
    return entity;
  }
}
