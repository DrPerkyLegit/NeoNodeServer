# NeoLegacy Minigame Server

A TypeScript/Node.js server for NeoLegacy protocol 79 / network build 571. It
supports Slime v10 worlds, dimension changes, player sessions and movement,
block interaction, shared chat, creative and recipe registries, plugins,
commands, survival block drops, and basic persistent operator/ban lists.

The generated default terrain is flat: bedrock at Y=0, dirt at Y=1-2, and grass
at Y=3. Slime worlds load when configured and save after changes and shutdown.
Players receive a 9x9 chunk area (radius four chunks), twice the previous
radius. Survival block breaks spawn collectible item entities; in-memory drops
expire after five minutes and are not persisted across server restarts.
The server is an extensible base for minigames, not a complete vanilla server:
the built-in recipes are intentionally limited, and mobs, combat, and a full
vanilla crafting implementation are not included.

## Requirements and startup

- Node.js 22.15 or newer (for built-in Zstandard support)
- A NeoLegacy client using protocol version 79 and network build 571

```powershell
npm start
```

By default the server listens on `0.0.0.0:25565` and loads
`worlds\flat.slime` as the `overworld` world using the `flat` terrain generator.
The common single-world settings are:

```powershell
$env:PORT = "25565"
$env:HOST = "0.0.0.0"
$env:MAX_PLAYERS = "8"
$env:WORLD_FILE = ".\worlds\flat.slime"
$env:WORLD_GENERATOR = "flat"
$env:SEED = "0"
$env:GAMEMODE = "survival"
$env:MAX_PACKETS_PER_SECOND = "10000"
$env:OPS = "YourUsername"
$env:VERBOSE = "true"
npm start
```

`GAMEMODE` can be `survival`, `creative`, or `adventure`. Creative inventory
updates are accepted only in creative mode and only for registered items.
`VERBOSE=true` logs every parsed incoming and outgoing game packet.

### Multiple worlds

Set `WORLDS` to a JSON array. Each entry has a unique 1-16 character `name`, a
`dimension` (`-1` Nether, `0` Overworld, `1` End), a Slime `file` path, and
optional decimal-string `seed` and `generator` name:

```powershell
$env:WORLDS = '[{"name":"lobby","dimension":0,"file":"worlds/lobby.slime","seed":"1","generator":"flat"},{"name":"nether","dimension":-1,"file":"worlds/nether.slime","seed":"2","generator":"flat"},{"name":"arena","dimension":0,"file":"worlds/arena.slime","seed":"3","generator":"flat"}]'
npm start
```

When `WORLDS` is set, it replaces `WORLD_FILE` and `SEED`. An Overworld-to-
Overworld switch sends the Nether dimension respawn first, then the destination
Overworld respawn, as required by this client. `/world <name>` switches an
operator between configured worlds.

### Moderation

Operators are initialized from the comma-separated `OPS` setting and persisted
in `moderation.json` (override with `MODERATION_FILE`). In-game operator
commands are `/op`, `/deop`, `/gamemode`, `/ban`, `/pardon`, `/banip`, and
`/unbanip`. `/gamemode <survival|creative|adventure> [player]` changes the
operator's or a named online player's mode. Username and IP bans are checked on
connect and persisted atomically. Use `/help` to see available commands and
`/tps` for current TPS and player count.

## Plugin API

Plugins can be loaded from a directory of CommonJS `.js` files using
`PLUGIN_DIR`; each file must export one plugin as `module.exports` or
`exports.plugin`. Plugins can also be passed directly to `createServer` from
TypeScript/JavaScript. Startup logs report configuration and world loading,
plugin loading, registry setup and validation, moderation loading, and listener
startup.

```js
const { createFlatChunk } = require('../../dist/src/index.js');

module.exports = {
  name: 'minigame-rules',
  onLoad(api) {
    api.items.register({
      id: 32000,
      name: 'arena token',
      tab: 15,
      maxStackSize: 16,
    });
    api.worldGenerators.register('island', (chunkX, chunkZ, context) => {
      const chunk = createFlatChunk(chunkX, chunkZ);
      const islandHeight = 4 + Number((BigInt(chunkX * 31 + chunkZ * 17) ^ context.seed) & 3n);
      chunk.blocks.fill(0);
      for (let y = 0; y <= islandHeight; y += 1) {
        const blockId = y === 0 ? 7 : y === islandHeight ? 2 : 3;
        chunk.blocks.fill(blockId, y * 256, (y + 1) * 256);
      }
      return chunk;
    });
  },
  onEnable(api) {
    api.events.on('blockPlace', ({ world }) => world.name !== 'lobby');
    api.events.on('blockBreak', ({ world }) => world.name !== 'lobby');
    api.events.on('playerDeath', ({ player, reason }) => {
      api.server.broadcast(`${player.name} died: ${reason}`);
    });

    api.commands.register({
      name: 'lobby',
      description: 'Return to the lobby.',
      async execute({ sender }) {
        await api.server.changeWorld(sender.name, 'lobby');
      },
    });

    api.scheduler.repeat(() => {
      for (const player of api.server.getOnlinePlayers()) {
        if (player.world.name === 'arena') {
          // Run a small, non-blocking minigame tick here.
        }
      }
    }, 20);
  },
};
```

Events include `serverStarted`, `serverStopping`, `playerJoin`, `playerLeave`,
`playerKick`, `playerChat`, `playerCommand`, `playerAction`, `customPayload`,
`playerMove`, `playerGameModeChange`, `playerDeath`, `blockBreak`,
`blockPlace`, `worldChange`, and `packet`. A cancellable listener returns
`false`; packet, command, and other mutable event objects can also set
`cancelled` where provided. Cancellation hooks must be synchronous so gameplay
decisions happen before state changes. Listener exceptions are logged and
cancellable actions fail closed. Async event/task/command failures are caught
and logged. Plugin `onLoad` and `onEnable` are synchronous lifecycle callbacks.
`onLoad(api)` is the setup phase: register blocks, items, recipes, terrain
generators, and packet policies there. The example assumes it is saved under
`examples/plugins/`.

Plugins can intercept supported or unhandled incoming packets through
`api.events.on('packet', listener)`. For unhandled packet IDs, the event has
`unsupported: true`, `packetId`, the raw packet `data`, and no decoded
`packet`; listeners can cancel it to prevent further handling. Plugins can
also register packet IDs that should be rejected and kick the sender before
packet decoding:

```js
onLoad(api) {
  const unregister = api.packets.decline([42, 43]);
  // Call unregister() to remove this registration if needed.
}
```

Packet IDs must be integers from 0 to 255. The registration returns an
idempotent unregister function. The existing per-client packet rate limit
also applies to all traffic.
`onEnable(api)` is for commands, events, and tasks; it may still register
content for compatibility. Registries are finalized only after every plugin
has loaded and enabled.

Plugins may declare `dependsOn: ['other-plugin']`. Dependencies are matched by
plugin name without regard to case. A dependency's `onLoad` and `onEnable`
callbacks complete before the dependent plugin's callbacks run. Missing
dependencies, duplicate plugin names, and dependency cycles stop startup with
an explicit error. Where dependencies allow, plugins retain their configured
order (or sorted filename order when loaded from `PLUGIN_DIR`).

The plugin API exposes named worlds and online-player lookup, TPS, global chat
broadcast, player world changes, kicks, game-mode changes, world saving,
death-event injection, a read-only view of registered item entities, task
scheduling in 50 ms ticks, commands, packet policies, and mutable
block/item/recipe/world-generator registries. Player
commands and gameplay actions can be cancelled; custom payloads, game-mode
changes, lifecycle transitions, and player kicks can be observed through
events. A block protection example is in
[examples/plugins/block-protection.js](./examples/plugins/block-protection.js).
Register blocks, items, recipes, and world generators during `onLoad`; those
registries are validated and sealed before the server starts accepting
connections. Set `WORLD_GENERATOR` for a single world or the `generator` field
in each `WORLDS` entry. Persisted Slime chunks are retained; the selected
generator is used to create chunks that are not already saved. Generator
callbacks are synchronous and must return a complete chunk with matching
coordinates and correctly sized block, metadata, lighting, and biome buffers.

The creative registry uses NeoLegacy's `neo|UpdCReg` custom payload with all 16
client item groups; recipes use `neo|UpdRReg`. The default recipe set contains
basic planks, sticks, crafting table, chest, and furnace recipes. Plugins may
register additional recipes through `api.recipes`. The item registry includes
the built-in blocks and common vanilla items; plugins can add standalone items
through `api.items`. Blocks drop
themselves by default (stone drops cobblestone and grass blocks drop dirt);
set a block's `drop` to `false` or to an explicit `{ id, count, damage }` stack
to customize drops.

The server derives a stable **local** numeric player identifier from the
normalized username for plugin use. It is not an authenticated Xbox XUID:
XUIDs received in client packets are ignored, and player XUID fields sent to
other clients are zero.

Player storage is maintained as 36 authoritative slots and translated to the
client's 45-slot inventory menu layout (crafting and armor slots, main
inventory, then hotbar). Pickup updates the exact affected menu slots and
persists the player state. Dropped item entities are tracked in the server
entity registry, scoped by world, and removed from the registry on pickup or
expiry.

Basic safety controls include framed-packet and buffer size limits, a per-
connection packet-rate limit (default 10000 packets per second, configurable
with `MAX_PACKETS_PER_SECOND` or `ServerOptions.maxPacketsPerSecond`, range
1-100000), username and coordinate validation, block reach checks,
registered-item validation, creative-mode enforcement, and exception-isolated
plugin hooks. The rate limit counts valid incoming protocol packets, including
packets that plugins later cancel; an over-limit log includes the packet ID and
observed count for diagnosis.

## Development

```powershell
npm run build
npm test
```

The server source is under `src\`; `npm start` compiles TypeScript before
launching it.
