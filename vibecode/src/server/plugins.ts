import type { ClientPacket } from '../protocol';
import type { BlockRegistry, ItemRegistry, RecipeRegistry } from './registry';
import type { WorldGeneratorRegistry } from './world-generators';
import type { WorldManager } from '../world/manager';
import type { SavedPlayer, World } from '../world/world';
import type { EntityRegistryView } from './entities';

export interface OnlinePlayer {
  readonly name: string;
  readonly xuid: bigint;
  readonly state: Readonly<SavedPlayer>;
  readonly world: World;
  sendMessage(message: string): void;
}

export interface BlockEvent {
  readonly player: OnlinePlayer;
  readonly world: World;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly blockId: number;
}

export interface PluginPacketEvent {
  readonly direction: 'incoming' | 'outgoing';
  readonly player?: OnlinePlayer;
  readonly packetId: number;
  readonly packet?: Readonly<ClientPacket>;
  readonly unsupported: boolean;
  readonly data: Readonly<Buffer>;
  cancelled: boolean;
}

export type PluginGameMode = 'survival' | 'creative' | 'adventure';

export interface PlayerCommandEvent {
  readonly player: OnlinePlayer;
  readonly command: string;
  cancelled: boolean;
}

export interface PlayerActionEvent {
  readonly player: OnlinePlayer;
  readonly action: 'swing' | 'block-action' | 'block-place' | 'entity-action' | 'entity-interaction' | 'custom-payload';
  readonly packetId: number;
  readonly packet: Readonly<ClientPacket>;
}

export interface ServerEvents {
  serverStarted: { host: string; port: number };
  serverStopping: Record<string, never>;
  playerJoin: { player: OnlinePlayer };
  playerLeave: { player: OnlinePlayer };
  playerKick: { player: OnlinePlayer; reason: string };
  playerChat: { player: OnlinePlayer; message: string };
  playerCommand: PlayerCommandEvent;
  playerAction: PlayerActionEvent;
  customPayload: { player: OnlinePlayer; channel: string; data: Readonly<Buffer> };
  playerGameModeChange: { player: OnlinePlayer; from: PluginGameMode; to: PluginGameMode };
  playerMove: { player: OnlinePlayer; from: Readonly<{ x: number; y: number; z: number }>; to: Readonly<{ x: number; y: number; z: number }> };
  playerDeath: { player: OnlinePlayer; reason: string };
  blockBreak: BlockEvent;
  blockPlace: BlockEvent;
  worldChange: { player: OnlinePlayer; from: World; to: World };
  packet: PluginPacketEvent;
}

type EventListener<K extends keyof ServerEvents> = (event: ServerEvents[K]) => unknown;

export class EventBus {
  private readonly listeners = new Map<keyof ServerEvents, Set<EventListener<keyof ServerEvents>>>();

  constructor(private readonly reportError: (message: string, error: unknown) => void) {}

  on<K extends keyof ServerEvents>(event: K, listener: EventListener<K>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as EventListener<keyof ServerEvents>);
    return () => listeners?.delete(listener as EventListener<keyof ServerEvents>);
  }

  emit<K extends keyof ServerEvents>(event: K, value: ServerEvents[K], cancellable = false): boolean {
    let allowed = true;
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        const result = listener(value as ServerEvents[keyof ServerEvents]);
        if (result === false && cancellable) allowed = false;
        if (isPromiseLike(result)) {
          if (cancellable) {
            allowed = false;
            this.reportError(`Cancellable plugin listener for ${event} must be synchronous`, new Error('Async cancellation is not supported'));
          }
          void Promise.resolve(result).catch((error: unknown) => this.reportError(`Async plugin listener failed for ${event}`, error));
        }
      } catch (error) {
        this.reportError(`Plugin listener failed for ${event}`, error);
        if (cancellable) allowed = false;
      }
    }
    return allowed;
  }
}

export interface ScheduledTask {
  cancel(): void;
}

export class TaskScheduler {
  private readonly tasks = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(private readonly reportError: (message: string, error: unknown) => void) {}

  repeat(task: () => void | Promise<void>, intervalTicks = 1): ScheduledTask {
    if (!Number.isInteger(intervalTicks) || intervalTicks < 1 || intervalTicks > 1200) {
      throw new RangeError('Task interval must be from 1 to 1200 ticks');
    }
    let running = false;
    const timer = setInterval(() => {
      if (running || this.closed) return;
      running = true;
      void Promise.resolve()
        .then(task)
        .catch((error: unknown) => this.reportError('Scheduled plugin task failed', error))
        .finally(() => { running = false; });
    }, intervalTicks * 50);
    timer.unref();
    this.tasks.add(timer);
    return { cancel: () => this.cancel(timer) };
  }

  later(task: () => void | Promise<void>, delayTicks: number): ScheduledTask {
    if (!Number.isInteger(delayTicks) || delayTicks < 1 || delayTicks > 1200) {
      throw new RangeError('Task delay must be from 1 to 1200 ticks');
    }
    const timer = setTimeout(() => {
      this.tasks.delete(timer);
      if (this.closed) return;
      void Promise.resolve()
        .then(task)
        .catch((error: unknown) => this.reportError('Scheduled plugin task failed', error));
    }, delayTicks * 50);
    timer.unref();
    this.tasks.add(timer);
    return { cancel: () => this.cancel(timer) };
  }

  close(): void {
    this.closed = true;
    for (const timer of this.tasks) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.tasks.clear();
  }

  private cancel(timer: NodeJS.Timeout): void {
    clearInterval(timer);
    clearTimeout(timer);
    this.tasks.delete(timer);
  }
}

export interface CommandContext {
  readonly sender: OnlinePlayer;
  readonly args: readonly string[];
  readonly isOperator: boolean;
  reply(message: string): void;
}

export interface CommandDefinition {
  name: string;
  description: string;
  operatorOnly?: boolean;
  execute(context: CommandContext): void | Promise<void>;
}

export interface PluginServerApi {
  getWorld(name: string): World | undefined;
  getWorlds(): ReadonlyArray<World>;
  getPlayer(username: string): OnlinePlayer | undefined;
  getOnlinePlayers(): ReadonlyArray<OnlinePlayer>;
  getTps(): number;
  broadcast(message: string): void;
  changeWorld(username: string, worldName: string): Promise<boolean>;
  kickPlayer(username: string, reason?: string): boolean;
  setGameMode(username: string, gameMode: PluginGameMode): boolean;
  saveWorld(name: string): Promise<boolean>;
  playerDeath(username: string, reason: string): void;
  readonly worlds: WorldManager;
  readonly entities: EntityRegistryView;
}

export class PacketRegistry {
  private readonly declined = new Map<number, number>();

  decline(packetIds: readonly number[]): () => void {
    if (!Array.isArray(packetIds) || packetIds.length === 0) {
      throw new Error('At least one packet ID must be provided');
    }
    const ids = [...new Set(packetIds)];
    for (const id of ids) {
      if (!Number.isInteger(id) || id < 0 || id > 255) {
        throw new RangeError(`Packet ID must be an integer from 0 to 255: ${id}`);
      }
    }
    for (const id of ids) this.declined.set(id, (this.declined.get(id) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const id of ids) {
        const remaining = (this.declined.get(id) ?? 1) - 1;
        if (remaining === 0) this.declined.delete(id);
        else this.declined.set(id, remaining);
      }
    };
  }

  isDeclined(packetId: number): boolean {
    return this.declined.has(packetId);
  }

  values(): ReadonlyArray<number> {
    return [...this.declined.keys()];
  }
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    const name = definition.name.toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) throw new Error(`Invalid command name: ${definition.name}`);
    if (!definition.description.trim()) throw new Error(`Command ${name} requires a description`);
    if (this.commands.has(name)) throw new Error(`Command is already registered: ${name}`);
    this.commands.set(name, { ...definition, name });
  }

  get(name: string): Readonly<CommandDefinition> | undefined {
    return this.commands.get(name.toLowerCase());
  }

  values(): ReadonlyArray<Readonly<CommandDefinition>> {
    return [...this.commands.values()];
  }
}

export interface PluginApi {
  readonly server: PluginServerApi;
  readonly blocks: BlockRegistry;
  readonly items: ItemRegistry;
  readonly recipes: RecipeRegistry;
  readonly worldGenerators: WorldGeneratorRegistry;
  readonly events: EventBus;
  readonly scheduler: TaskScheduler;
  readonly commands: CommandRegistry;
  readonly packets: PacketRegistry;
  log(message: string): void;
}

export interface ServerPlugin {
  readonly name: string;
  readonly dependsOn?: readonly string[];
  onLoad?(api: PluginApi): void;
  onEnable?(api: PluginApi): void;
  onDisable?(): void | Promise<void>;
}

export class PluginManager {
  private readonly enabled: ServerPlugin[] = [];

  constructor(readonly api: PluginApi, private readonly reportError: (message: string, error: unknown) => void) {}

  enable(plugins: readonly ServerPlugin[]): void {
    const orderedPlugins = orderPlugins(plugins);
    for (const plugin of orderedPlugins) {
      try {
        this.api.log(`Loading plugin ${plugin.name}`);
        const loadResult = plugin.onLoad?.(this.api);
        if (isPromiseLike(loadResult)) {
          void Promise.resolve(loadResult).catch((error: unknown) => this.reportError(`Plugin ${plugin.name} failed to load`, error));
          throw new Error('Plugin onLoad must complete synchronously');
        }
        const enableResult = plugin.onEnable?.(this.api);
        if (isPromiseLike(enableResult)) {
          void Promise.resolve(enableResult).catch((error: unknown) => this.reportError(`Plugin ${plugin.name} failed to enable`, error));
          throw new Error('Plugin onEnable must complete synchronously');
        }
        this.enabled.push(plugin);
        this.api.log(`Loaded plugin ${plugin.name}`);
      } catch (error) {
        this.reportError(`Plugin ${plugin.name} failed to load`, error);
        throw new Error(`Unable to load plugin "${plugin.name}"`, { cause: error });
      }
    }
  }

  async disable(): Promise<void> {
    for (const plugin of [...this.enabled].reverse()) {
      try {
        await plugin.onDisable?.();
      } catch (error) {
        this.reportError(`Plugin ${plugin.name} failed to disable`, error);
      }
    }
    this.enabled.length = 0;
  }
}

function orderPlugins(plugins: readonly ServerPlugin[]): ServerPlugin[] {
  const pluginsByName = new Map<string, ServerPlugin>();
  const originalNames = new Map<string, string>();
  for (const plugin of plugins) {
    const name = plugin.name.trim();
    const normalizedName = name.toLowerCase();
    if (!name) throw new Error('Plugins must have a non-empty name');
    if (pluginsByName.has(normalizedName)) throw new Error(`Duplicate plugin name: ${name}`);
    if (plugin.onLoad === undefined && plugin.onEnable === undefined) {
      throw new Error(`Plugin "${name}" must define onLoad or onEnable`);
    }
    if (
      plugin.dependsOn !== undefined &&
      (!Array.isArray(plugin.dependsOn) || plugin.dependsOn.some((dependency) => typeof dependency !== 'string' || !dependency.trim()))
    ) {
      throw new Error(`Plugin "${name}" has an invalid dependsOn list`);
    }
    pluginsByName.set(normalizedName, plugin);
    originalNames.set(normalizedName, name);
  }

  const dependents = new Map<string, string[]>();
  const dependencyCounts = new Map<string, number>();
  for (const [normalizedName, plugin] of pluginsByName) {
    const dependencies = new Set((plugin.dependsOn ?? []).map((dependency) => dependency.trim().toLowerCase()));
    dependencyCounts.set(normalizedName, dependencies.size);
    for (const dependency of dependencies) {
      if (!pluginsByName.has(dependency)) {
        throw new Error(`Plugin "${plugin.name}" depends on missing plugin "${dependency}"`);
      }
      const entries = dependents.get(dependency) ?? [];
      entries.push(normalizedName);
      dependents.set(dependency, entries);
    }
  }

  const inputOrder = new Map([...pluginsByName.keys()].map((name, index) => [name, index]));
  const ready = [...pluginsByName.keys()].filter((name) => dependencyCounts.get(name) === 0);
  const ordered: ServerPlugin[] = [];
  while (ready.length > 0) {
    const normalizedName = ready.shift()!;
    ordered.push(pluginsByName.get(normalizedName)!);
    for (const dependent of dependents.get(normalizedName) ?? []) {
      const remaining = dependencyCounts.get(dependent)! - 1;
      dependencyCounts.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort((left, right) => inputOrder.get(left)! - inputOrder.get(right)!);
      }
    }
  }
  if (ordered.length !== pluginsByName.size) {
    const unresolved = [...pluginsByName.keys()]
      .filter((name) => dependencyCounts.get(name)! > 0)
      .map((name) => originalNames.get(name) ?? name);
    throw new Error(`Plugin dependency cycle detected: ${unresolved.join(', ')}`);
  }
  return ordered;
}

export function playerView(
  name: string,
  xuid: bigint,
  player: SavedPlayer,
  world: World,
  sendMessage: (message: string) => void,
): OnlinePlayer {
  return {
    name,
    xuid,
    get state() {
      return { ...player, inventory: player.inventory.map((item) => item && { ...item }) };
    },
    get world() {
      return world;
    },
    sendMessage,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value;
}
