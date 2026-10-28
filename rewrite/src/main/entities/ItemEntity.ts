import type { ItemStack } from '../items/ItemStack';
import { Entity } from './Entity';

export class ItemEntity extends Entity {
  pickupDelayTicks = 10;

  constructor(
    id: number,
    public stack: ItemStack,
    x: number,
    y: number,
    z: number,
  ) {
    super(id, x, y, z, 0, 0, 5);
    if (stack.isEmpty) throw new Error('Dropped item stack must not be empty');
  }

  tick(): void {
    if (this.pickupDelayTicks > 0) this.pickupDelayTicks -= 1;
  }
}
