import type { Item } from './Item';

export class ItemStack {
  constructor(
    public readonly item: Item,
    public count: number,
    public damage = 0,
  ) {
    this.validate();
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  clone(): ItemStack {
    return new ItemStack(this.item, this.count, this.damage);
  }

  canMerge(other: ItemStack): boolean {
    return this.item.id === other.item.id &&
      this.damage === other.damage &&
      this.item.maxDamage === 0 &&
      other.item.maxDamage === 0;
  }

  private validate(): void {
    if (!Number.isInteger(this.count) || this.count < 0 || this.count > this.item.maxStackSize) {
      throw new RangeError(`Stack count must be between 0 and ${this.item.maxStackSize}`);
    }
    if (!Number.isInteger(this.damage) || this.damage < 0 || this.damage > 32767) {
      throw new RangeError(`Invalid stack damage: ${this.damage}`);
    }
  }
}
