import { Logger } from './utils/Logger';
import { WorldServer } from './server/WorldServer';
import { createLegacyPacketRegistry } from './network/LegacyPacketRegistry';
import { LegacyServerPacketHandler } from './network/LegacyServerPacketHandler';
import { TcpGameServer } from './network/TcpGameServer';
import { PluginManager } from './plugin/PluginManager';
import path from 'node:path';

const TICK_INTERVAL_MS = 50;
const TICK_CHECK_INTERVAL_MS = 10;

async function main(): Promise<void> {
  Logger.info('Starting NeoNode Server - 1.0.0');
  const worldServer = await WorldServer.load();
  const pluginContext: Record<string, unknown> = {
    worldServer,
    packetHandler: undefined,
    networkServer: undefined,
  };
  const pluginManager = new PluginManager(path.join(process.cwd(), 'plugins'), pluginContext);
  const packetHandler = new LegacyServerPacketHandler(worldServer, pluginManager);
  pluginContext.packetHandler = packetHandler;
  const networkServer = new TcpGameServer(
    createLegacyPacketRegistry(),
    packetHandler,
    worldServer.properties.maxPlayers,
    pluginManager,
  );
  pluginContext.networkServer = networkServer;
  try {
    await pluginManager.loadAll();
    await pluginManager.emitAsync('server:starting', { server: pluginContext });
    await networkServer.listen(worldServer.properties.host, worldServer.properties.port);
    await pluginManager.emitAsync('server:started', { server: pluginContext });
  } catch (error) {
    await networkServer.close().catch((closeError: unknown) => {
      Logger.error('Unable to close network server after startup failure:', closeError);
    });
    await pluginManager.disableAll().catch((pluginError: unknown) => {
      Logger.error('Unable to disable plugins after startup failure:', pluginError);
    });
    throw error;
  }
  let nextTickAt = performance.now() + TICK_INTERVAL_MS;
  const tickTimer = setInterval(() => {
    const now = performance.now();
    if (now < nextTickAt) return;

    const missedTicks = Math.floor((now - nextTickAt) / TICK_INTERVAL_MS);
    nextTickAt += (missedTicks + 1) * TICK_INTERVAL_MS;
    worldServer.tick();
    packetHandler.flushMovementUpdates();
    try {
      pluginManager.emit('server:tick', { server: pluginContext, tps: worldServer.tps });
      pluginManager.emit('world:tick', { worlds: worldServer.worlds, tps: worldServer.tps });
    } catch (error) {
      Logger.error('Plugin tick hook failed:', error);
    }
  }, TICK_CHECK_INTERVAL_MS);
  Logger.success(`World "${worldServer.properties.worldName}" initialized`);

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = (): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      void (async () => {
        clearInterval(tickTimer);
        await runShutdownStep('server:stopping hook', () =>
          pluginManager.emitAsync('server:stopping', { server: pluginContext }));
        await runShutdownStep('network shutdown', () => networkServer.close());
        await runShutdownStep('world save', () => worldServer.save());
        await runShutdownStep('server:stopped hook', () =>
          pluginManager.emitAsync('server:stopped', { server: pluginContext }));
        await runShutdownStep('plugin shutdown', () => pluginManager.disableAll());
        resolve();
      })().catch((error: unknown) => {
        Logger.error('Unable to shut down cleanly:', error);
        process.exitCode = 1;
        resolve();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function runShutdownStep(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    Logger.error(`Unable to complete ${label}:`, error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    Logger.error('Unable to initialize server:', error);
    process.exitCode = 1;
  });
}