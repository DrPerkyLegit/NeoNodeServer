import { join } from 'node:path';
import { World } from './world/world';
import { WorldManager } from './world/manager';
import { createServer } from './server/server';
import { loadPlugins } from './server/plugin-loader';

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid TCP port: ${value}`);
  return port;
}

async function main(): Promise<void> {
  console.info('[init] Reading server configuration');
  const host = process.env.HOST ?? '0.0.0.0';
  const port = parsePort(process.env.PORT ?? '25565');
  const maxPlayers = Number(process.env.MAX_PLAYERS ?? '8');
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 251) {
    throw new Error('MAX_PLAYERS must be an integer from 1 to 251');
  }
  const maxPacketsPerSecond = Number(process.env.MAX_PACKETS_PER_SECOND ?? '10000');
  if (!Number.isInteger(maxPacketsPerSecond) || maxPacketsPerSecond < 1 || maxPacketsPerSecond > 100_000) {
    throw new Error('MAX_PACKETS_PER_SECOND must be an integer from 1 to 100000');
  }

  console.info('[init] Loading configured worlds');
  const worldManager = await loadConfiguredWorlds();
  console.info(`[init] Loaded ${worldManager.names().length} world(s)`);
  const pluginDirectory = process.env.PLUGIN_DIR;
  console.info(pluginDirectory
    ? `[init] Loading plugins from ${pluginDirectory}`
    : '[init] No plugin directory configured');
  const plugins = pluginDirectory ? await loadPlugins(pluginDirectory) : [];
  console.info(`[init] Loaded ${plugins.length} plugin module(s)`);
  const gameMode = parseGameMode(process.env.GAMEMODE ?? 'survival');
  console.info('[init] Creating server and initializing plugins and registries');
  const gameServer = createServer({
    host,
    port,
    maxPlayers,
    worlds: worldManager,
    plugins,
    gameMode,
    maxPacketsPerSecond,
    moderationFile: process.env.MODERATION_FILE ?? join(process.cwd(), 'moderation.json'),
    operators: (process.env.OPS ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    verbose: process.env.VERBOSE === '1' || process.env.VERBOSE?.toLowerCase() === 'true',
  });
  console.info('[init] Starting server listener');
  await gameServer.listen();
  console.info('[init] Server startup complete');

  const shutdown = async (): Promise<void> => {
    try {
      await gameServer.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(`Server shutdown failed: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function loadConfiguredWorlds(): Promise<WorldManager> {
  const raw = process.env.WORLDS;
  if (!raw) {
    const world = await World.load({
      name: 'overworld',
      dimension: 0,
      filePath: process.env.WORLD_FILE ?? join(process.cwd(), 'worlds', 'flat.slime'),
      seed: BigInt(process.env.SEED ?? '0'),
      generator: process.env.WORLD_GENERATOR ?? 'flat',
    });
    return new WorldManager([world]);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) {
    throw new Error('WORLDS must be a JSON array containing 1-32 world configurations');
  }
  const worldOptions = parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`WORLDS[${index}] must be an object`);
    const value = entry as { name?: unknown; dimension?: unknown; file?: unknown; seed?: unknown; generator?: unknown };
    if (
      typeof value.name !== 'string' ||
      typeof value.file !== 'string' ||
      ![-1, 0, 1].includes(value.dimension as number) ||
      (value.seed !== undefined && typeof value.seed !== 'string') ||
      (value.generator !== undefined && typeof value.generator !== 'string')
    ) {
      throw new Error(`WORLDS[${index}] requires name, file, dimension (-1, 0, 1), and optional decimal-string seed and generator name`);
    }
    return {
      name: value.name,
      dimension: value.dimension as -1 | 0 | 1,
      filePath: value.file,
      seed: BigInt(value.seed ?? 0),
      generator: value.generator ?? 'flat',
    };
  });
  return new WorldManager(await Promise.all(worldOptions.map((options) => World.load(options))));
}

function parseGameMode(value: string): 'survival' | 'creative' | 'adventure' {
  switch (value.toLowerCase()) {
    case 'survival': return 'survival';
    case 'creative': return 'creative';
    case 'adventure': return 'adventure';
    default: throw new Error(`Invalid GAMEMODE "${value}"; expected survival, creative, or adventure`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`Unable to start server: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
