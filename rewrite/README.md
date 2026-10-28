# NeoNode Server plugins

Plugins are CommonJS JavaScript files loaded from the `plugins/` directory under the server's current working directory. The server creates this directory if it does not exist and loads `.js` and `.cjs` files in filename order at startup. A plugin load or enable error is reported and prevents the server from starting; plugin code runs with the same permissions as the server process, so only install trusted plugins.

Copy [`examples/plugins/spawn-protection.js`](./examples/plugins/spawn-protection.js) into `plugins/` to try the sample. It cancels block breaking and placement within eight blocks of spawn and demonstrates editing outgoing chat packets.

## Plugin module

Export an object with a unique, case-sensitive name. `onEnable` and `onDisable` may be asynchronous:

```js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',

  async onEnable(api) {
    api.on('player:chat', (event) => {
      event.message = event.message.toUpperCase();
    });
  },

  async onDisable(api) {
    // Release plugin-owned resources.
  },
};
```

`api.on(name, listener)` registers a listener, `api.once(name, listener)` removes it after its first call, and `api.off(name, listener)` unregisters it. Listeners execute synchronously in plugin load/registration order. Exceptions propagate into the server operation that emitted the event; keep listeners small and do not block the event loop. `api.server` provides `worldServer`, `packetHandler`, and `networkServer` references for integrations that need direct server access.

Events are case-sensitive. Events with a `cancelled` property can be stopped by setting it to `true`. A cancelled incoming packet is not passed to the packet handler; cancelled outgoing packets are not sent. Packet events are emitted first as a generic event and then as a packet-specific event.

## Events

| Event | Payload | Cancellable / editable |
|---|---|---|
| `server:starting`, `server:started`, `server:stopping`, `server:stopped` | `{ server }` | Lifecycle hooks; may be async |
| `server:tick` | `{ server, tps }` | No |
| `world:tick` | `{ worlds, tps }` | No |
| `connection:open`, `connection:close` | `{ connection }` | No |
| `packet:inbound`, `packet:outbound` | `{ packet, connection, direction, cancelled }` | Yes; replace or edit `packet` |
| `packet:inbound:<PacketName>`, `packet:outbound:<PacketName>` | Same packet event object | Yes; emitted after generic packet event |
| `player:prelogin` | `{ username, connection, cancelled }` | Yes |
| `player:login` | `{ username, connection, cancelled }` | Yes; username must remain 1-16 valid username characters |
| `player:login:complete`, `player:join` | `{ player, connection }` | No |
| `player:quit` | `{ player, connection }` | No |
| `player:chat` | `{ player, message, packet, connection, cancelled }` | Yes; edit `message` |
| `player:command` | `{ player, command, connection, cancelled, handled }` | Yes; edit `command` or set `handled` |
| `player:move` | `{ player, packet, connection, x, y, z, yaw, pitch, onGround, isFlying, cancelled }` | Yes; edit movement values |
| `player:move:complete` | `{ player, packet, connection }` | No |
| `player:select-slot` | `{ player, slot, packet, connection }` | No |
| `player:animate`, `player:action` | `{ player, packet, connection, cancelled }` | Yes |
| `player:container-close` | `{ player, packet, connection }` | No |
| `player:inventory-click` | `{ player, packet, slot, button, connection, cancelled }` | Yes |
| `player:inventory-click:complete` | `{ player, packet, connection }` | No |
| `block:break` | `{ player, world, x, y, z, blockId, packet, connection, cancelled }` | Yes |
| `block:break:complete` | `{ player, world, x, y, z, blockId }` | No |
| `block:place` | `{ player, world, x, y, z, blockId, packet, connection, cancelled }` | Yes |
| `block:place:complete` | `{ player, world, x, y, z, blockId }` | No |
| `item:drop` | `{ player, item, cancelled }` | Yes |
| `item:pickup` | `{ player, item, cancelled }` | Yes |
| `item:pickup:complete` | `{ player, item }` | No |

Packet listeners receive decoded `GamePacket` instances. Edit their packet fields directly (for example `event.packet.strings[0] = 'rewritten'`) or assign another compatible packet instance to `event.packet`. These hooks run for all packet send paths, including batched packets and broadcasts. Normal packet validation still applies to gameplay actions after plugin listeners run.
