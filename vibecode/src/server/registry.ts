import { BufferWriter } from '../binary';
import type { InventoryStack } from '../world/world';

export type CreativeTab = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface BlockDefinition {
  id: number;
  name: string;
  tab: CreativeTab;
  damage?: number;
  placeable?: boolean;
  drop?: { id: number; count?: number; damage?: number } | false;
}

export interface ItemDefinition {
  id: number;
  name: string;
  tab: CreativeTab;
  damage?: number;
  maxStackSize?: number;
}

export interface RecipeItem {
  id: number;
  damage?: number;
}

function itemMaxStackSize(id: number): number {
  return [256, 257, 258, 259, 261, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 345, 347, 354, 355].includes(id)
    ? 1
    : 64;
}

export type RecipeDefinition =
  | {
      type: 'shaped';
      group: number;
      result: InventoryStack;
      pattern: Array<Array<RecipeItem | null>>;
    }
  | {
      type: 'shapeless';
      group: number;
      result: InventoryStack;
      ingredients: RecipeItem[];
    };

const vanillaBlocks: Array<[number, string, CreativeTab]> = [
  [1, 'stone', 0], [2, 'grass block', 0], [3, 'dirt', 0], [4, 'cobblestone', 0],
  [5, 'wood planks', 0], [6, 'sapling', 1], [12, 'sand', 0], [13, 'gravel', 0],
  [17, 'wood log', 0], [18, 'leaves', 1], [20, 'glass', 0], [24, 'sandstone', 0],
  [35, 'wool', 1],   [41, 'gold block', 0], [42, 'iron block', 0], [43, 'double stone slab', 0],
  [44, 'stone slab', 0], [45, 'brick block', 0], [47, 'bookshelf', 1],
  [48, 'moss stone', 0], [49, 'obsidian', 0], [53, 'wood stairs', 1],
  [54, 'chest', 1], [56, 'diamond ore', 0], [57, 'diamond block', 0],
  [58, 'crafting table', 1], [60, 'farmland', 1], [61, 'furnace', 2],
  [62, 'lit furnace', 2], [67, 'cobblestone stairs', 1], [73, 'redstone ore', 0],
  [74, 'lit redstone ore', 0], [79, 'ice', 0], [80, 'snow block', 0],
  [82, 'clay block', 0], [87, 'netherrack', 0], [88, 'soul sand', 0],
  [89, 'glowstone', 0], [91, 'jack o lantern', 1], [95, 'stained glass', 0],
  [98, 'stone bricks', 0], [102, 'glass pane', 1], [103, 'melon block', 0],
  [107, 'fence gate', 1], [108, 'brick stairs', 1], [109, 'stone brick stairs', 1],
  [110, 'mycelium', 0], [112, 'nether bricks', 0], [113, 'nether brick fence', 1],
  [114, 'nether brick stairs', 1], [116, 'enchantment table', 1],
  [121, 'end stone', 0], [123, 'redstone lamp', 2], [124, 'lit redstone lamp', 2],
  [125, 'double wood slab', 1], [126, 'wood slab', 1], [128, 'sandstone stairs', 1],
  [129, 'emerald ore', 0], [133, 'emerald block', 0], [134, 'spruce stairs', 1],
  [135, 'birch stairs', 1], [136, 'jungle stairs', 1], [155, 'quartz block', 0],
  [156, 'quartz stairs', 1], [159, 'stained clay', 0], [161, 'dark oak leaves', 1],
  [162, 'acacia log', 0], [163, 'acacia stairs', 1], [164, 'dark oak stairs', 1],
  [170, 'hay bale', 0], [172, 'hardened clay', 0], [173, 'coal block', 0],
  [174, 'packed ice', 0], [179, 'red sandstone', 0], [180, 'red sandstone stairs', 1],
  [181, 'double red sandstone slab', 0], [182, 'red sandstone slab', 0],
  [183, 'spruce fence gate', 1], [184, 'birch fence gate', 1],
  [185, 'jungle fence gate', 1], [186, 'dark oak fence gate', 1],
  [187, 'acacia fence gate', 1], [188, 'spruce fence', 1], [189, 'birch fence', 1],
  [190, 'jungle fence', 1], [191, 'dark oak fence', 1], [192, 'acacia fence', 1],
  [198, 'grass path', 1], [199, 'item frame', 1], [200, 'chorus flower', 1],
  [201, 'purpur block', 0], [202, 'purpur pillar', 0], [203, 'purpur stairs', 1],
  [204, 'double purpur slab', 0], [205, 'purpur slab', 0], [206, 'end bricks', 0],
  [207, 'beetroot crop', 5], [208, 'grass path variant', 1], [209, 'end gateway', 13],
  [210, 'repeating command block', 13], [211, 'chain command block', 13],
  [212, 'frosted ice', 0], [213, 'magma block', 0],
];

export class BlockRegistry {
  private readonly blocks = new Map<number, Readonly<BlockDefinition>>();
  private readonly names = new Map<string, number>();
  private cachedPayload: Buffer | undefined;
  private sealed = false;

  constructor(definitions: readonly BlockDefinition[] = vanillaBlocks.map(([id, name, tab]) => ({ id, name, tab }))) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: BlockDefinition): void {
    if (this.sealed) throw new Error('Block registry is sealed; register blocks during plugin initialization');
    const name = definition.name.trim().toLowerCase();
    if (!Number.isInteger(definition.id) || definition.id < 0 || definition.id > 32767) {
      throw new RangeError(`Block ID must be an integer from 0 to 32767: ${definition.id}`);
    }
    if (!name || name.length > 64) throw new RangeError('Block name must be 1-64 characters');
    if (!Number.isInteger(definition.tab) || definition.tab < 0 || definition.tab > 15) {
      throw new RangeError(`Creative tab must be from 0 to 15: ${definition.tab}`);
    }
    if (definition.damage !== undefined && (!Number.isInteger(definition.damage) || definition.damage < -32768 || definition.damage > 32767)) {
      throw new RangeError(`Block damage must fit a signed 16-bit integer: ${definition.damage}`);
    }
    if (definition.placeable !== undefined && typeof definition.placeable !== 'boolean') {
      throw new TypeError('Block placeable must be a boolean');
    }
    if (definition.drop !== undefined && definition.drop !== false) {
      if (!Number.isInteger(definition.drop.id) || definition.drop.id < 0 || definition.drop.id > 32767) {
        throw new RangeError(`Block drop item ID must be an integer from 0 to 32767: ${definition.drop.id}`);
      }
      if (definition.drop.count !== undefined && (!Number.isInteger(definition.drop.count) || definition.drop.count < 1 || definition.drop.count > 64)) {
        throw new RangeError(`Block drop count must be from 1 to 64: ${definition.drop.count}`);
      }
      if (definition.drop.damage !== undefined && (!Number.isInteger(definition.drop.damage) || definition.drop.damage < -32768 || definition.drop.damage > 32767)) {
        throw new RangeError(`Block drop damage must fit a signed 16-bit integer: ${definition.drop.damage}`);
      }
    }
    if (this.blocks.has(definition.id) || this.names.has(name)) {
      throw new Error(`Block ID or name is already registered: ${definition.id} (${name})`);
    }
    const normalized = Object.freeze({
      ...definition,
      ...(definition.drop ? { drop: Object.freeze({ ...definition.drop }) } : {}),
      name,
    });
    this.blocks.set(normalized.id, normalized);
    this.names.set(name, normalized.id);
    this.cachedPayload = undefined;
  }

  seal(): void {
    this.sealed = true;
  }

  get(id: number): Readonly<BlockDefinition> | undefined {
    return this.blocks.get(id);
  }

  byName(name: string): Readonly<BlockDefinition> | undefined {
    const id = this.names.get(name.trim().toLowerCase());
    return id === undefined ? undefined : this.blocks.get(id);
  }

  values(): ReadonlyArray<Readonly<BlockDefinition>> {
    return [...this.blocks.values()];
  }

  creativePayload(): Buffer {
    if (this.cachedPayload) return Buffer.from(this.cachedPayload);
    const groups: BlockDefinition[][] = Array.from({ length: 16 }, () => []);
    for (const definition of this.blocks.values()) groups[definition.tab].push(definition);
    const writer = new BufferWriter();
    for (const group of groups) {
      writer.short(group.length);
      for (const block of group) {
        writer.short(block.id).short(block.damage ?? 0).short(-1);
      }
    }
    const payload = writer.build();
    if (payload.length > 32767) throw new RangeError('Creative registry exceeds the NeoLegacy 32 KiB payload limit');
    this.cachedPayload = payload;
    return Buffer.from(payload);
  }
}

const vanillaItems: Array<[number, string, CreativeTab]> = [
  [256, 'iron shovel', 2], [257, 'iron pickaxe', 2], [258, 'iron axe', 2],
  [259, 'flint and steel', 2], [260, 'apple', 3], [261, 'bow', 2], [262, 'arrow', 2],
  [263, 'coal', 0], [264, 'diamond', 0], [265, 'iron ingot', 0], [266, 'gold ingot', 0],
  [267, 'iron sword', 2], [268, 'wooden sword', 2], [269, 'wooden shovel', 2],
  [270, 'wooden pickaxe', 2], [271, 'wooden axe', 2], [272, 'stone sword', 2],
  [273, 'stone shovel', 2], [274, 'stone pickaxe', 2], [275, 'stone axe', 2],
  [276, 'diamond sword', 2], [277, 'diamond shovel', 2], [278, 'diamond pickaxe', 2],
  [279, 'diamond axe', 2], [280, 'stick', 0], [287, 'string', 0], [288, 'feather', 0],
  [289, 'gunpowder', 0], [295, 'seeds', 5], [297, 'bread', 3],
  [318, 'flint', 0], [331, 'redstone dust', 0], [332, 'snowball', 2],
  [336, 'brick', 0], [337, 'clay ball', 0], [338, 'sugar cane', 5],
  [339, 'paper', 0], [340, 'book', 0], [341, 'slimeball', 0], [344, 'egg', 2],
  [345, 'compass', 2], [347, 'clock', 2],
  [352, 'bone', 2], [353, 'sugar', 0], [354, 'cake', 3], [355, 'bed', 3],
  [360, 'melon slice', 3], [388, 'emerald', 0], [399, 'nether star', 0],
];

export class ItemRegistry {
  private readonly items = new Map<number, Readonly<ItemDefinition>>();
  private readonly names = new Map<string, number>();
  private cachedPayload: Buffer | undefined;
  private sealed = false;

  constructor(definitions: readonly ItemDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ItemDefinition): void {
    if (this.sealed) throw new Error('Item registry is sealed; register items during plugin initialization');
    const name = definition.name.trim().toLowerCase();
    if (!Number.isInteger(definition.id) || definition.id < 0 || definition.id > 32767) {
      throw new RangeError(`Item ID must be an integer from 0 to 32767: ${definition.id}`);
    }
    if (!name || name.length > 64) throw new RangeError('Item name must be 1-64 characters');
    if (!Number.isInteger(definition.tab) || definition.tab < 0 || definition.tab > 15) {
      throw new RangeError(`Creative tab must be from 0 to 15: ${definition.tab}`);
    }
    if (definition.damage !== undefined && (!Number.isInteger(definition.damage) || definition.damage < -32768 || definition.damage > 32767)) {
      throw new RangeError(`Item damage must fit a signed 16-bit integer: ${definition.damage}`);
    }
    const maxStackSize = definition.maxStackSize ?? 64;
    if (!Number.isInteger(maxStackSize) || maxStackSize < 1 || maxStackSize > 64) {
      throw new RangeError(`Item max stack size must be from 1 to 64: ${maxStackSize}`);
    }
    if (this.items.has(definition.id) || this.names.has(name)) {
      throw new Error(`Item ID or name is already registered: ${definition.id} (${name})`);
    }
    this.items.set(definition.id, Object.freeze({ ...definition, name, maxStackSize }));
    this.names.set(name, definition.id);
    this.cachedPayload = undefined;
  }

  registerBlock(block: Readonly<BlockDefinition>): void {
    if (!this.items.has(block.id)) {
      this.register({ id: block.id, name: block.name, tab: block.tab, damage: block.damage });
    }
  }

  seal(): void {
    this.sealed = true;
  }

  get(id: number): Readonly<ItemDefinition> | undefined {
    return this.items.get(id);
  }

  byName(name: string): Readonly<ItemDefinition> | undefined {
    const id = this.names.get(name.trim().toLowerCase());
    return id === undefined ? undefined : this.items.get(id);
  }

  values(): ReadonlyArray<Readonly<ItemDefinition>> {
    return [...this.items.values()];
  }

  creativePayload(): Buffer {
    if (this.cachedPayload) return Buffer.from(this.cachedPayload);
    const groups: ItemDefinition[][] = Array.from({ length: 16 }, () => []);
    for (const item of this.items.values()) groups[item.tab].push(item);
    const writer = new BufferWriter();
    for (const group of groups) {
      writer.short(group.length);
      for (const item of group) writer.short(item.id).short(item.damage ?? 0).short(-1);
    }
    const payload = writer.build();
    if (payload.length > 32767) throw new RangeError('Creative registry exceeds the NeoLegacy 32 KiB payload limit');
    this.cachedPayload = payload;
    return Buffer.from(payload);
  }
}

export class RecipeRegistry {
  private readonly recipes: RecipeDefinition[] = [];
  private cachedPayload: Buffer | undefined;
  private sealed = false;

  register(recipe: RecipeDefinition): void {
    if (this.sealed) throw new Error('Recipe registry is sealed; register recipes during plugin initialization');
    if (!Number.isInteger(recipe.group) || recipe.group < 0 || recipe.group > 7) {
      throw new RangeError('Recipe group must be from 0 to 7');
    }
    validateRecipeItem(recipe.result);
    if (!Number.isInteger(recipe.result.count) || recipe.result.count < 1 || recipe.result.count > 64) {
      throw new RangeError('Recipe result count must be from 1 to 64');
    }
    if (recipe.type === 'shaped') {
      const { pattern } = recipe;
      if (pattern.length < 1 || pattern.length > 3 || pattern.some((row) => row.length !== pattern[0].length || row.length < 1 || row.length > 3)) {
        throw new RangeError('Shaped recipe patterns must be rectangular and 1-3 cells wide and high');
      }
      for (const row of pattern) for (const item of row) if (item) validateRecipeItem(item);
    } else {
      if (recipe.ingredients.length < 1 || recipe.ingredients.length > 9) throw new RangeError('Shapeless recipes require 1-9 ingredients');
      for (const item of recipe.ingredients) validateRecipeItem(item);
    }
    this.recipes.push(cloneRecipe(recipe));
    this.cachedPayload = undefined;
  }

  seal(): void {
    this.sealed = true;
  }

  values(): ReadonlyArray<RecipeDefinition> {
    return this.recipes.map((recipe) => freezeRecipe(cloneRecipe(recipe)));
  }

  payload(): Buffer {
    if (this.cachedPayload) return Buffer.from(this.cachedPayload);
    const writer = new BufferWriter().int(this.recipes.length);
    for (const recipe of this.recipes) {
      writer
        .byte(recipe.type === 'shaped' ? 2 : 1)
        .byte(recipe.group);
      writeRecipeStack(writer, recipe.result);
      if (recipe.type === 'shaped') {
        writer.byte((recipe.pattern[0].length << 2) | recipe.pattern.length);
        for (const row of recipe.pattern) {
          for (const item of row) {
            writer.bool(item === null);
            if (item) writeRecipeItem(writer, item);
          }
        }
      } else {
        writer.byte(recipe.ingredients.length);
        for (const item of recipe.ingredients) {
          writer.bool(false);
          writeRecipeItem(writer, item);
        }
      }
    }
    const payload = writer.build();
    if (payload.length > 32767) throw new RangeError('Recipe registry exceeds the NeoLegacy 32 KiB payload limit');
    this.cachedPayload = payload;
    return Buffer.from(payload);
  }
}

export function createDefaultRecipeRegistry(): RecipeRegistry {
  const registry = new RecipeRegistry();
  registry.register({
    type: 'shapeless',
    group: 0,
    result: { id: 5, count: 4, damage: 0 },
    ingredients: [{ id: 17 }],
  });
  registry.register({
    type: 'shaped',
    group: 0,
    result: { id: 58, count: 1, damage: 0 },
    pattern: [[{ id: 5 }, { id: 5 }], [{ id: 5 }, { id: 5 }]],
  });
  registry.register({
    type: 'shaped',
    group: 0,
    result: { id: 280, count: 4, damage: 0 },
    pattern: [[{ id: 5 }], [{ id: 5 }]],
  });
  registry.register({
    type: 'shaped',
    group: 0,
    result: { id: 54, count: 1, damage: 0 },
    pattern: [[{ id: 5 }, { id: 5 }, { id: 5 }], [{ id: 5 }, null, { id: 5 }], [{ id: 5 }, { id: 5 }, { id: 5 }]],
  });
  registry.register({
    type: 'shaped',
    group: 0,
    result: { id: 61, count: 1, damage: 0 },
    pattern: [[{ id: 4 }, { id: 4 }, { id: 4 }], [{ id: 4 }, null, { id: 4 }], [{ id: 4 }, { id: 4 }, { id: 4 }]],
  });
  return registry;
}

function validateRecipeItem(item: RecipeItem): void {
  if (!Number.isInteger(item.id) || item.id < 0 || item.id > 32767) throw new RangeError(`Invalid recipe item ID: ${item.id}`);
  if (!Number.isInteger(item.damage ?? 0) || (item.damage ?? 0) < -32768 || (item.damage ?? 0) > 32767) {
    throw new RangeError(`Invalid recipe item damage: ${item.damage}`);
  }
}

function writeRecipeStack(writer: BufferWriter, stack: InventoryStack): void {
  writer.short(stack.id).byte(stack.count).short(stack.damage).short(-1);
}

function writeRecipeItem(writer: BufferWriter, item: RecipeItem): void {
  writer.short(item.id).short(item.damage ?? 0).short(-1);
}

function cloneRecipe(recipe: RecipeDefinition): RecipeDefinition {
  return recipe.type === 'shaped'
    ? { ...recipe, result: { ...recipe.result }, pattern: recipe.pattern.map((row) => row.map((item) => item && { ...item })) }
    : { ...recipe, result: { ...recipe.result }, ingredients: recipe.ingredients.map((item) => ({ ...item })) };
}

function freezeRecipe(recipe: RecipeDefinition): RecipeDefinition {
  if (recipe.type === 'shaped') {
    recipe.pattern.forEach((row) => {
      row.forEach((item) => { if (item) Object.freeze(item); });
      Object.freeze(row);
    });
    Object.freeze(recipe.pattern);
  } else {
    recipe.ingredients.forEach((item) => Object.freeze(item));
    Object.freeze(recipe.ingredients);
  }
  Object.freeze(recipe.result);
  return Object.freeze(recipe);
}

export function buildCustomPayloadPacket(channel: string, payload: Buffer): Buffer {
  if (payload.length > 32767) throw new RangeError('Custom payload exceeds the NeoLegacy 32 KiB limit');
  return new BufferWriter().byte(250).utf(channel).short(payload.length).bytes(payload).build();
}

export function createDefaultItemRegistry(blocks: BlockRegistry): ItemRegistry {
  const registry = new ItemRegistry();
  for (const block of blocks.values()) registry.registerBlock(block);
  for (const [id, name, tab] of vanillaItems) {
    if (!registry.get(id)) registry.register({ id, name, tab, maxStackSize: itemMaxStackSize(id) });
  }
  return registry;
}

export function buildCreativeRegistryPacket(registry: BlockRegistry | ItemRegistry): Buffer {
  return buildCustomPayloadPacket('neo|UpdCReg', registry.creativePayload());
}

export function buildRecipeRegistryPacket(registry: RecipeRegistry): Buffer {
  return buildCustomPayloadPacket('neo|UpdRReg', registry.payload());
}
