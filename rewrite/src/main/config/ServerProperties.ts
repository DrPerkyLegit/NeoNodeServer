import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ServerPropertyValues {
  readonly host: string;
  readonly port: number;
  readonly maxPlayers: number;
  readonly gameMode: 'survival' | 'creative';
  readonly gamertags: boolean;
  readonly worldName: string;
  readonly worldType: 'flat';
  readonly seed: bigint;
}

const defaults: ServerPropertyValues = {
  host: '0.0.0.0',
  port: 25565,
  maxPlayers: 20,
  gameMode: 'survival',
  gamertags: true,
  worldName: 'defaultWorld',
  worldType: 'flat',
  seed: 0n,
};

const propertyKeys = new Set([
  'host',
  'port',
  'maxPlayers',
  'gameMode',
  'gamertags',
  'worldName',
  'worldType',
  'seed',
]);

export class ServerProperties implements ServerPropertyValues {
  private constructor(
    public readonly host: string,
    public readonly port: number,
    public readonly maxPlayers: number,
    public readonly gameMode: 'survival' | 'creative',
    public readonly gamertags: boolean,
    public readonly worldName: string,
    public readonly worldType: 'flat',
    public readonly seed: bigint,
    public readonly filePath: string,
  ) {}

  static async load(filePath = path.join(process.cwd(), 'server.properties')): Promise<ServerProperties> {
    let contents: string;
    try {
      contents = await readFile(filePath, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new Error(`Unable to read server properties "${filePath}": ${errorMessage(error)}`, { cause: error });
      }
      await writeFile(filePath, formatDefaults(), { flag: 'wx' }).catch(async (writeError: unknown) => {
        if (!isAlreadyExists(writeError)) {
          throw new Error(`Unable to create server properties "${filePath}": ${errorMessage(writeError)}`, { cause: writeError });
        }
      });
      contents = await readFile(filePath, 'utf8');
    }

    return ServerProperties.parse(contents, filePath);
  }

  static parse(contents: string, filePath = path.join(process.cwd(), 'server.properties')): ServerProperties {
    const values: Record<string, string> = {};
    for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) throw new Error(`Invalid server.properties line ${index + 1}: expected key=value`);
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!propertyKeys.has(key)) throw new Error(`Unknown server.properties key "${key}" on line ${index + 1}`);
      if (key in values) throw new Error(`Duplicate server.properties key "${key}"`);
      values[key] = value;
    }

    const host = values.host ?? defaults.host;
    if (!host) throw new Error('server.properties host must not be empty');
    const port = parseInteger(values.port ?? String(defaults.port), 'port', 1, 65535);
    const maxPlayers = parseInteger(values.maxPlayers ?? String(defaults.maxPlayers), 'maxPlayers', 1, 251);
    const gameMode = values.gameMode ?? defaults.gameMode;
    if (gameMode !== 'survival' && gameMode !== 'creative') {
      throw new Error(`Unsupported gameMode "${gameMode}"; supported modes: survival, creative`);
    }
    const gamertagsValue = values.gamertags ?? String(defaults.gamertags);
    if (gamertagsValue !== 'true' && gamertagsValue !== 'false') {
      throw new Error('server.properties gamertags must be true or false');
    }
    const gamertags = gamertagsValue === 'true';
    const worldName = values.worldName ?? defaults.worldName;
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(worldName)) {
      throw new Error('server.properties worldName must be 1-48 letters, digits, "_" or "-"');
    }
    const worldType = values.worldType ?? defaults.worldType;
    if (worldType !== 'flat') throw new Error(`Unsupported worldType "${worldType}"; supported type: flat`);
    const seedValue = values.seed ?? defaults.seed.toString();
    if (!/^-?\d+$/.test(seedValue)) throw new Error('server.properties seed must be a decimal integer');

    return new ServerProperties(
      host,
      port,
      maxPlayers,
      gameMode,
      gamertags,
      worldName,
      worldType,
      BigInt(seedValue),
      filePath,
    );
  }

  getWorldFilePath(): string {
    return path.join(path.dirname(this.filePath), 'worlds', `${this.worldName}.slime`);
  }
}

function parseInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`server.properties ${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`server.properties ${name} must be from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function formatDefaults(): string {
  return [
    '# NeoLegacy server configuration',
    'host=0.0.0.0',
    'port=25565',
    'maxPlayers=20',
    `gameMode=${defaults.gameMode}`,
    `gamertags=${defaults.gamertags}`,
    'worldName=defaultWorld',
    'worldType=flat',
    'seed=0',
    '',
  ].join('\n');
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
