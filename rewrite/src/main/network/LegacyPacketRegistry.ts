import { PacketRegistry } from './PacketRegistry';
import { KeepAlivePacket } from './packets/KeepAlivePacket';
import { LoginPacket } from './packets/LoginPacket';
import { ChatPacket } from './packets/ChatPacket';
import { MovePlayerPacket } from './packets/MovePlayerPacket';
import { PreLoginPacket } from './packets/PreLoginPacket';
import { SetCarriedItemPacket } from './packets/SetCarriedItemPacket';
import { PlayerActionPacket } from './packets/PlayerActionPacket';
import { UseItemPacket } from './packets/UseItemPacket';
import { AnimatePacket } from './packets/AnimatePacket';
import { PlayerCommandPacket } from './packets/PlayerCommandPacket';
import { PlayerInputPacket } from './packets/PlayerInputPacket';
import { ContainerClosePacket } from './packets/ContainerClosePacket';
import { ContainerClickPacket } from './packets/ContainerClickPacket';
import { ContainerAckPacket } from './packets/ContainerAckPacket';
import { DisconnectPacket } from './packets/DisconnectPacket';
import { ServerSettingsChangedPacket } from './packets/ServerSettingsChangedPacket';

export function createLegacyPacketRegistry(): PacketRegistry {
  return new PacketRegistry()
    .register('KeepAlive', () => new KeepAlivePacket())
    .register('Login', () => new LoginPacket())
    .register('PreLogin', () => new PreLoginPacket())
    .register('SetCarriedItem', () => new SetCarriedItemPacket())
    .register('Chat', () => new ChatPacket())
    .register('MovePlayerGround', () => new MovePlayerPacket('ground'))
    .register('MovePlayerPosition', () => new MovePlayerPacket('position'))
    .register('MovePlayerRotation', () => new MovePlayerPacket('rotation'))
    .register('MovePlayerPositionRotation', () => new MovePlayerPacket('positionRotation'))
    .register('PlayerAction', () => new PlayerActionPacket())
    .register('UseItem', () => new UseItemPacket())
    .register('Animate', () => new AnimatePacket())
    .register('PlayerCommand', () => new PlayerCommandPacket())
    .register('PlayerInput', () => new PlayerInputPacket())
    .register('ContainerClose', () => new ContainerClosePacket())
    .register('ContainerClick', () => new ContainerClickPacket())
    .register('ContainerAck', () => new ContainerAckPacket())
    .register('Disconnect', () => new DisconnectPacket())
    .register('ServerSettingsChanged', () => new ServerSettingsChangedPacket());
}
