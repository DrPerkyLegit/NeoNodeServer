import { Inventory } from '../items/Inventory';
import type { ItemStack } from '../items/ItemStack';
import { Entity } from './Entity';

export class Player extends Entity {
  readonly inventory = new Inventory(36);
  readonly joinedAt = Date.now();
  readonly playerIndex: number;
  carriedItem: ItemStack | undefined;
  gameMode: 'survival' | 'creative' = 'survival';
  selectedSlot = 0;
  onGround = false;
  isFlying = false;
  lastChatAt = 0;
  override health = 20;

  constructor(
    id: number,
    public readonly username: string,
    public readonly smallId: number,
    public readonly address: string,
  ) {
    super(id);
    this.playerIndex = Math.max(0, smallId - 4);
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) throw new Error(`Invalid username "${username}"`);
    if (!Number.isInteger(smallId) || smallId < 1 || smallId > 255) {
      throw new RangeError(`Invalid player small ID: ${smallId}`);
    }
  }
}
