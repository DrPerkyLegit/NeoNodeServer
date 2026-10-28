import type { InventoryStack, SavedPlayer } from '../world/world';

export const PLAYER_STORAGE_SIZE = 36;
export const INVENTORY_MENU_SIZE = 45;

export function inventoryMenuContents(inventory: SavedPlayer['inventory']): Array<InventoryStack | null> {
  if (inventory.length !== PLAYER_STORAGE_SIZE) {
    throw new RangeError(`Player storage must contain ${PLAYER_STORAGE_SIZE} slots`);
  }
  return [
    null, null, null, null, null, null, null, null, null,
    ...inventory.slice(9).map(cloneStack),
    ...inventory.slice(0, 9).map(cloneStack),
  ];
}

export function storageIndexFromMenuSlot(slot: number): number | undefined {
  if (!Number.isInteger(slot) || slot < 9 || slot >= INVENTORY_MENU_SIZE) return undefined;
  return slot < 36 ? slot : slot - 36;
}

export function menuSlotFromStorageIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= PLAYER_STORAGE_SIZE) {
    throw new RangeError(`Invalid player inventory slot: ${index}`);
  }
  return index < 9 ? index + 36 : index;
}

export function insertItemStack(
  inventory: SavedPlayer['inventory'],
  item: InventoryStack,
  maxStackSize: number,
): number[] | undefined {
  if (!Number.isInteger(maxStackSize) || maxStackSize < 1) {
    throw new RangeError(`Invalid maximum stack size: ${maxStackSize}`);
  }
  let capacity = 0;
  for (const stack of inventory) {
    if (!stack) capacity += maxStackSize;
    else if (stack.id === item.id && stack.damage === item.damage) {
      capacity += Math.max(0, maxStackSize - stack.count);
    }
    if (capacity >= item.count) break;
  }
  if (capacity < item.count) return undefined;

  let remaining = item.count;
  const changedSlots: number[] = [];
  for (let slot = 0; slot < inventory.length && remaining > 0; slot += 1) {
    const stack = inventory[slot];
    if (!stack || stack.id !== item.id || stack.damage !== item.damage || stack.count >= maxStackSize) continue;
    const amount = Math.min(remaining, maxStackSize - stack.count);
    stack.count += amount;
    remaining -= amount;
    changedSlots.push(slot);
  }
  for (let slot = 0; slot < inventory.length && remaining > 0; slot += 1) {
    if (inventory[slot]) continue;
    const amount = Math.min(remaining, maxStackSize);
    inventory[slot] = { id: item.id, count: amount, damage: item.damage };
    remaining -= amount;
    changedSlots.push(slot);
  }
  return changedSlots;
}

function cloneStack(stack: InventoryStack | null): InventoryStack | null {
  return stack ? { ...stack } : null;
}
