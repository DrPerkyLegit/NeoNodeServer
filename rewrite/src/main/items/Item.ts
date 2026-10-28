export interface ItemDefinition {
  readonly id: number;
  readonly name: string;
  readonly maxStackSize: number;
  readonly maxDamage: number;
}

export class Item {
  constructor(
    public readonly id: number,
    public readonly name: string,
    public readonly maxStackSize = 64,
    public readonly maxDamage = 0,
  ) {
    if (!Number.isInteger(id) || id < 0 || id > 32767) throw new RangeError(`Invalid item ID: ${id}`);
    if (!name.trim()) throw new Error('Item name must not be empty');
    if (!Number.isInteger(maxStackSize) || maxStackSize < 1 || maxStackSize > 127) {
      throw new RangeError(`Invalid maximum stack size: ${maxStackSize}`);
    }
    if (!Number.isInteger(maxDamage) || maxDamage < 0 || maxDamage > 32767) {
      throw new RangeError(`Invalid maximum item damage: ${maxDamage}`);
    }
  }
}

export class ItemRegistry {
  private readonly itemsById = new Map<number, Item>();
  private readonly itemsByName = new Map<string, Item>();

  register(definition: ItemDefinition): Item {
    const key = definition.name.toLowerCase();
    if (this.itemsById.has(definition.id)) throw new Error(`Item ID ${definition.id} is already registered`);
    if (this.itemsByName.has(key)) throw new Error(`Item "${definition.name}" is already registered`);
    const item = new Item(definition.id, definition.name, definition.maxStackSize, definition.maxDamage);
    this.itemsById.set(item.id, item);
    this.itemsByName.set(key, item);
    return item;
  }

  get(id: number): Item | undefined {
    return this.itemsById.get(id);
  }

  getByName(name: string): Item | undefined {
    return this.itemsByName.get(name.toLowerCase());
  }

  values(): ReadonlyArray<Item> {
    return [...this.itemsById.values()];
  }
}
