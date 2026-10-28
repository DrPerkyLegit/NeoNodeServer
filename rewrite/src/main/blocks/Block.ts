export interface BlockDefinition {
  readonly id: number;
  readonly name: string;
  readonly dropItemId?: number;
  readonly unbreakable?: boolean;
}

export class Block {
  constructor(
    public readonly id: number,
    public readonly name: string,
    public readonly dropItemId: number | undefined,
    public readonly unbreakable: boolean,
  ) {
    if (!Number.isInteger(id) || id < 0 || id > 255) throw new RangeError(`Invalid block ID: ${id}`);
    if (!name.trim()) throw new Error('Block name must not be empty');
    if (dropItemId !== undefined && (!Number.isInteger(dropItemId) || dropItemId < 0 || dropItemId > 32767)) {
      throw new RangeError(`Invalid block drop item ID: ${dropItemId}`);
    }
  }
}

export class BlockRegistry {
  private readonly blocksById = new Map<number, Block>();
  private readonly blocksByName = new Map<string, Block>();

  register(definition: BlockDefinition): Block {
    const key = definition.name.toLowerCase();
    if (this.blocksById.has(definition.id)) throw new Error(`Block ID ${definition.id} is already registered`);
    if (this.blocksByName.has(key)) throw new Error(`Block "${definition.name}" is already registered`);
    const block = new Block(
      definition.id,
      definition.name,
      definition.dropItemId,
      definition.unbreakable ?? false,
    );
    this.blocksById.set(block.id, block);
    this.blocksByName.set(key, block);
    return block;
  }

  get(id: number): Block | undefined {
    return this.blocksById.get(id);
  }

  getByName(name: string): Block | undefined {
    return this.blocksByName.get(name.toLowerCase());
  }

  values(): ReadonlyArray<Block> {
    return [...this.blocksById.values()];
  }
}
