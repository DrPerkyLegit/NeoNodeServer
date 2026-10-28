import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerPlugin } from './plugins';

export async function loadPlugins(directory: string): Promise<ServerPlugin[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const plugins: ServerPlugin[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const filePath = join(directory, entry.name);
    const loaded: unknown = await import(pathToFileURL(filePath).href);
    if (!loaded || typeof loaded !== 'object') throw new Error(`Plugin module "${filePath}" must export a plugin`);
    const module = loaded as { default?: unknown; plugin?: unknown };
    const plugin = module.default ?? module.plugin;
    if (!isServerPlugin(plugin)) throw new Error(`Plugin module "${filePath}" must default-export a ServerPlugin`);
    plugins.push(plugin);
  }
  return plugins;
}

function isServerPlugin(value: unknown): value is ServerPlugin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ServerPlugin>;
  return typeof candidate.name === 'string' &&
    (typeof candidate.onLoad === 'function' || typeof candidate.onEnable === 'function');
}
