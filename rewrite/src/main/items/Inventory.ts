import { ItemStack } from './ItemStack';

export class Inventory {
  private readonly slots: Array<ItemStack | undefined>;

  constructor(public readonly size = 36) {
    if (!Number.isInteger(size) || size < 1 || size > 4096) {
      throw new RangeError(`Inventory size must be from 1 to 4096: ${size}`);
    }
    this.slots = Array.from({ length: size });
  }

  get(slot: number): ItemStack | undefined {
    this.validateSlot(slot);
    return this.slots[slot]?.clone();
  }

  set(slot: number, stack: ItemStack | undefined): void {
    this.validateSlot(slot);
    this.slots[slot] = stack && !stack.isEmpty ? stack.clone() : undefined;
  }

  take(slot: number, count: number): ItemStack | undefined {
    this.validateSlot(slot);
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`Invalid item count: ${count}`);
    const stack = this.slots[slot];
    if (!stack) return undefined;
    const taken = Math.min(count, stack.count);
    const result = new ItemStack(stack.item, taken, stack.damage);
    stack.count -= taken;
    if (stack.isEmpty) this.slots[slot] = undefined;
    return result;
  }

  add(stack: ItemStack): ItemStack | undefined {
    return this.addToRange(stack, 0, this.size);
  }

  addToHotbarFirst(stack: ItemStack): ItemStack | undefined {
    const hotbarEnd = Math.min(9, this.size);
    const hotbarOverflow = this.addToRange(stack, 0, hotbarEnd);
    if (!hotbarOverflow || hotbarEnd === this.size) return hotbarOverflow;
    return this.addToRange(hotbarOverflow, hotbarEnd, this.size);
  }

  snapshot(): ReadonlyArray<ItemStack | undefined> {
    return this.slots.map((stack) => stack?.clone());
  }

  private validateSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.size) {
      throw new RangeError(`Inventory slot ${slot} is outside 0..${this.size - 1}`);
    }
  }

  private addToRange(stack: ItemStack, start: number, end: number): ItemStack | undefined {
    let remaining = stack.count;
    for (let slot = start; slot < end; slot += 1) {
      const current = this.slots[slot];
      if (!current || !current.canMerge(stack) || current.count >= current.item.maxStackSize) continue;
      const moved = Math.min(remaining, current.item.maxStackSize - current.count);
      current.count += moved;
      remaining -= moved;
      if (remaining === 0) return undefined;
    }

    for (let slot = start; slot < end; slot += 1) {
      if (this.slots[slot]) continue;
      const moved = Math.min(remaining, stack.item.maxStackSize);
      this.slots[slot] = new ItemStack(stack.item, moved, stack.damage);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }
    return new ItemStack(stack.item, remaining, stack.damage);
  }
}
