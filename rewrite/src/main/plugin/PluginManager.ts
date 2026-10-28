import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '../utils/Logger';

export interface PluginEvent {
  cancelled?: boolean;
  [key: string]: unknown;
}

export type PluginListener = (event: PluginEvent) => void;

export interface PluginApi {
  readonly server: Record<string, unknown>;
  readonly name: string;
  on(eventName: string, listener: PluginListener): void;
  once(eventName: string, listener: PluginListener): void;
  off(eventName: string, listener: PluginListener): void;
}

interface PluginDefinition {
  name: string;
  version?: string;
  onEnable?: (api: PluginApi) => void | Promise<void>;
  onDisable?: (api: PluginApi) => void | Promise<void>;
}

interface RegisteredPlugin {
  readonly definition: PluginDefinition;
  readonly api: PluginApi;
  readonly listeners: Map<string, Set<PluginListener>>;
}

export class PluginManager {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly listeners = new Map<string, Array<{ plugin: RegisteredPlugin; listener: PluginListener; once: boolean }>>();

  constructor(
    public readonly directory: string,
    public readonly server: Record<string, unknown>,
  ) {}

  async loadAll(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory))
      .filter((file) => file.endsWith('.js') || file.endsWith('.cjs'))
      .sort();
    for (const file of files) await this.load(path.join(this.directory, file));
  }

  async load(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    let exported: unknown;
    try {
      exported = require(absolutePath) as unknown;
    } catch (error) {
      throw new Error(`Unable to load plugin "${absolutePath}": ${errorMessage(error)}`, { cause: error });
    }

    if (!isPluginDefinition(exported)) {
      throw new Error(`Plugin "${absolutePath}" must export a plugin definition with a name`);
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(exported.name)) {
      throw new Error(`Plugin "${absolutePath}" has an invalid name "${exported.name}"`);
    }
    if (this.plugins.has(exported.name)) throw new Error(`Plugin "${exported.name}" is already loaded`);

    const listeners = new Map<string, Set<PluginListener>>();
    let plugin: RegisteredPlugin;
    const api: PluginApi = {
      name: exported.name,
      server: this.server,
      on: (eventName, listener) => this.addListener(plugin, listeners, eventName, listener, false),
      once: (eventName, listener) => this.addListener(plugin, listeners, eventName, listener, true),
      off: (eventName, listener) => this.removeListener(plugin, eventName, listener),
    };
    plugin = { definition: exported, api, listeners };
    this.plugins.set(exported.name, plugin);
    try {
      await exported.onEnable?.(api);
      Logger.info(`Loaded plugin "${exported.name}"${exported.version ? ` v${exported.version}` : ''}`);
    } catch (error) {
      this.removePluginListeners(plugin);
      this.plugins.delete(exported.name);
      throw new Error(`Unable to enable plugin "${exported.name}": ${errorMessage(error)}`, { cause: error });
    }
  }

  emit(eventName: string, event: PluginEvent = {}): PluginEvent {
    const currentListeners = [...(this.listeners.get(eventName) ?? [])];
    for (const entry of currentListeners) {
      if (entry.once) this.removeEntry(eventName, entry);
      const result: unknown = entry.listener(event);
      assertSynchronousListenerResult(result);
    }
    return event;
  }

  async emitAsync(eventName: string, event: PluginEvent = {}): Promise<PluginEvent> {
    const currentListeners = [...(this.listeners.get(eventName) ?? [])];
    for (const entry of currentListeners) {
      if (entry.once) this.removeEntry(eventName, entry);
      await entry.listener(event);
    }
    return event;
  }

  async disableAll(): Promise<void> {
    const failures: unknown[] = [];
    for (const plugin of [...this.plugins.values()].reverse()) {
      try {
        await plugin.definition.onDisable?.(plugin.api);
      } catch (error) {
        failures.push(error);
      } finally {
        this.removePluginListeners(plugin);
        this.plugins.delete(plugin.definition.name);
        Logger.info(`Disabled plugin "${plugin.definition.name}"`);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'One or more plugins failed to disable');
  }

  hasListeners(eventName: string): boolean {
    return (this.listeners.get(eventName)?.length ?? 0) > 0;
  }

  hasListenersWithPrefix(prefix: string): boolean {
    for (const [eventName, listeners] of this.listeners) {
      if (eventName.startsWith(prefix) && listeners.length > 0) return true;
    }
    return false;
  }

  get loadedPluginNames(): readonly string[] {
    return [...this.plugins.keys()];
  }

  private addListener(
    plugin: RegisteredPlugin,
    ownedListeners: Map<string, Set<PluginListener>>,
    eventName: string,
    listener: PluginListener,
    once: boolean,
  ): void {
    if (!eventName.trim()) throw new Error('Plugin event name must not be empty');
    if (typeof listener !== 'function') throw new TypeError('Plugin event listener must be a function');
    const eventListeners = this.listeners.get(eventName) ?? [];
    eventListeners.push({ plugin, listener, once });
    this.listeners.set(eventName, eventListeners);
    const owned = ownedListeners.get(eventName) ?? new Set<PluginListener>();
    owned.add(listener);
    ownedListeners.set(eventName, owned);
  }

  private removeListener(
    plugin: RegisteredPlugin,
    eventName: string,
    listener: PluginListener,
  ): void {
    const eventListeners = this.listeners.get(eventName);
    if (eventListeners) {
      const index = eventListeners.findIndex((entry) => entry.plugin === plugin && entry.listener === listener);
      if (index >= 0) this.removeEntry(eventName, eventListeners[index]);
    }
  }

  private removeEntry(
    eventName: string,
    entry: { plugin: RegisteredPlugin; listener: PluginListener; once: boolean },
  ): void {
    const eventListeners = this.listeners.get(eventName);
    if (eventListeners) {
      const index = eventListeners.indexOf(entry);
      if (index >= 0) eventListeners.splice(index, 1);
      if (eventListeners.length === 0) this.listeners.delete(eventName);
    }
    const stillRegistered = (this.listeners.get(eventName) ?? [])
      .some((candidate) => candidate.plugin === entry.plugin && candidate.listener === entry.listener);
    if (!stillRegistered) {
      const owned = entry.plugin.listeners.get(eventName);
      owned?.delete(entry.listener);
      if (owned?.size === 0) entry.plugin.listeners.delete(eventName);
    }
  }

  private removePluginListeners(plugin: RegisteredPlugin): void {
    for (const eventName of plugin.listeners.keys()) {
      const retained = (this.listeners.get(eventName) ?? []).filter((entry) => entry.plugin !== plugin);
      if (retained.length > 0) this.listeners.set(eventName, retained);
      else this.listeners.delete(eventName);
    }
    plugin.listeners.clear();
  }
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
  return typeof value === 'object' && value !== null &&
    'name' in value && typeof value.name === 'string' &&
    (!('onEnable' in value) || typeof value.onEnable === 'function') &&
    (!('onDisable' in value) || typeof value.onDisable === 'function');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSynchronousListenerResult(result: unknown): void {
  if (typeof result !== 'object' || result === null || !('then' in result) || typeof result.then !== 'function') {
    return;
  }
  void Promise.resolve(result).catch((error: unknown) => {
    Logger.error('A synchronous plugin event listener returned a rejected promise:', error);
  });
  throw new Error('Plugin event listeners must be synchronous; use onEnable/onDisable for asynchronous work');
}
