import { EntityRegistry } from '../entities/EntityRegistry';
import { ItemEntity } from '../entities/ItemEntity';
import type { Player } from '../entities/Player';
import { ItemRegistry } from '../items/Item';
import { ItemStack } from '../items/ItemStack';
import { BlockRegistry } from './Block';
import type { World } from '../world/World';

export class WorldInteractionService {
  constructor(
    private readonly blocks: BlockRegistry,
    private readonly items: ItemRegistry,
    private readonly entities: EntityRegistry,
  ) {}

  breakBlock(
    world: World,
    player: Player,
    x: number,
    y: number,
    z: number,
    onDrop?: (entity: ItemEntity) => void,
  ): number {
    const blockId = world.getBlock(x, y, z);
    if (blockId === 0) return 0;
    const block = this.blocks.get(blockId);
    if (!block) throw new Error(`World contains unregistered block ID ${blockId}`);
    if (block.unbreakable) return 0;
    const droppedItem = player.gameMode === 'creative' || block.dropItemId === undefined
      ? undefined
      : this.items.get(block.dropItemId);
    if (player.gameMode !== 'creative' && block.dropItemId !== undefined && !droppedItem) {
      throw new Error(`Block "${block.name}" drops unregistered item ID ${block.dropItemId}`);
    }

    world.setBlock(x, y, z, 0);
    if (droppedItem) {
      const entity = this.entities.add(new ItemEntity(
        this.entities.allocateId(),
        new ItemStack(droppedItem, 1),
        x + 0.5,
        y + 0.5,
        z + 0.5,
      ));
      world.addEntity(entity);
      onDrop?.(entity);
    }
    return blockId;
  }

  pickupItem(world: World, player: Player, entityId: number): boolean {
    const entity = world.entities.get(entityId);
    if (!(entity instanceof ItemEntity) || entity.pickupDelayTicks > 0) return false;
    if (Math.hypot(entity.x - player.x, entity.y - player.y, entity.z - player.z) > 2.5) return false;

    const overflow = player.inventory.addToHotbarFirst(entity.stack);
    if (!overflow) {
      world.removeEntity(entity.id);
      this.entities.remove(entity.id);
    } else {
      entity.stack = overflow;
    }
    return true;
  }

  placeBlock(world: World, player: Player, x: number, y: number, z: number, blockId: number): void {
    if (world.getBlock(x, y, z) !== 0) throw new Error('Cannot place a block into a non-empty position');
    const block = this.blocks.get(blockId);
    if (!block || block.id === 0) throw new Error(`Cannot place unregistered block ID ${blockId}`);
    let slotStack: ItemStack | undefined;
    if (player.gameMode !== 'creative') {
      slotStack = player.inventory.get(player.selectedSlot);
      if (!slotStack || slotStack.item.id !== blockId) {
        throw new Error(`Selected hotbar slot does not contain a placeable item for block ${blockId}`);
      }
      player.inventory.take(player.selectedSlot, 1);
    }

    try {
      world.setBlock(x, y, z, blockId);
    } catch (error) {
      if (slotStack && player.gameMode !== 'creative') player.inventory.add(new ItemStack(slotStack.item, 1, slotStack.damage));
      throw error;
    }
  }
}
