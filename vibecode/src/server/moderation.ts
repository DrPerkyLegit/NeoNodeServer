import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isIP } from 'node:net';

interface ModerationFile {
  operators: string[];
  usernameBans: Array<{ username: string; reason: string }>;
  ipBans: Array<{ address: string; reason: string }>;
}

export class ModerationStore {
  private readonly operators = new Set<string>();
  private readonly usernameBans = new Map<string, { username: string; reason: string }>();
  private readonly ipBans = new Map<string, { address: string; reason: string }>();
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string, initialOperators: readonly string[]) {
    for (const username of initialOperators) {
      const normalized = normalizeUsername(username);
      if (normalized) this.operators.add(normalized);
    }
  }

  static async load(filePath: string, initialOperators: readonly string[] = []): Promise<ModerationStore> {
    const store = new ModerationStore(filePath, initialOperators);
    try {
      const data: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (!data || typeof data !== 'object') throw new Error('Moderation data must be an object');
      const value = data as Partial<ModerationFile>;
      if (!Array.isArray(value.operators) || !Array.isArray(value.usernameBans) || !Array.isArray(value.ipBans)) {
        throw new Error('Moderation data is missing operators or ban lists');
      }
      for (const username of value.operators) {
        if (typeof username !== 'string') throw new Error('Invalid operator username');
        const normalized = normalizeUsername(username);
        if (normalized) store.operators.add(normalized);
      }
      for (const entry of value.usernameBans) {
        if (!entry || typeof entry.username !== 'string' || typeof entry.reason !== 'string') {
          throw new Error('Invalid username ban record');
        }
        const username = normalizeUsername(entry.username);
        if (username) store.usernameBans.set(username, { username: entry.username, reason: entry.reason });
      }
      for (const entry of value.ipBans) {
        if (!entry || typeof entry.address !== 'string' || typeof entry.reason !== 'string') {
          throw new Error('Invalid IP ban record');
        }
        const address = normalizeIp(entry.address);
        if (!address) throw new Error(`Invalid IP address in moderation data: ${entry.address}`);
        store.ipBans.set(address, { address: entry.address, reason: entry.reason });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Unable to load moderation data "${filePath}": ${(error as Error).message}`, { cause: error });
      }
    }
    return store;
  }

  isOperator(username: string): boolean {
    return this.operators.has(normalizeUsername(username));
  }

  isUsernameBanned(username: string): string | undefined {
    return this.usernameBans.get(normalizeUsername(username))?.reason;
  }

  isIpBanned(address: string): string | undefined {
    const normalized = normalizeIp(address);
    return normalized ? this.ipBans.get(normalized)?.reason : undefined;
  }

  async setOperator(username: string, enabled: boolean): Promise<void> {
    const key = normalizeUsername(username);
    if (!key) throw new Error('Operator username must not be empty');
    const previous = this.operators.has(key);
    if (enabled) this.operators.add(key);
    else this.operators.delete(key);
    await this.persistOrRollback(() => previous ? this.operators.add(key) : this.operators.delete(key));
  }

  async banUsername(username: string, reason: string): Promise<void> {
    const key = normalizeUsername(username);
    if (!key) throw new Error('Username to ban must not be empty');
    const previous = this.usernameBans.get(key);
    this.usernameBans.set(key, { username, reason: normalizeReason(reason) });
    await this.persistOrRollback(() => previous ? this.usernameBans.set(key, previous) : this.usernameBans.delete(key));
  }

  async pardonUsername(username: string): Promise<void> {
    const key = normalizeUsername(username);
    const previous = this.usernameBans.get(key);
    if (!previous) return;
    this.usernameBans.delete(key);
    await this.persistOrRollback(() => this.usernameBans.set(key, previous));
  }

  async banIp(address: string, reason: string): Promise<void> {
    const key = normalizeIp(address);
    if (!key) throw new Error(`Invalid IP address: ${address}`);
    const previous = this.ipBans.get(key);
    this.ipBans.set(key, { address: key, reason: normalizeReason(reason) });
    await this.persistOrRollback(() => previous ? this.ipBans.set(key, previous) : this.ipBans.delete(key));
  }

  async pardonIp(address: string): Promise<void> {
    const key = normalizeIp(address);
    if (!key) throw new Error(`Invalid IP address: ${address}`);
    const previous = this.ipBans.get(key);
    if (!previous) return;
    this.ipBans.delete(key);
    await this.persistOrRollback(() => this.ipBans.set(key, previous));
  }

  private async persistOrRollback(rollback: () => void): Promise<void> {
    const write = this.saveQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const data: ModerationFile = {
        operators: [...this.operators].sort(),
        usernameBans: [...this.usernameBans.values()],
        ipBans: [...this.ipBans.values()],
      };
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(data, null, 2));
      await rename(tempPath, this.filePath);
    });
    this.saveQueue = write.catch(() => {});
    try {
      await write;
    } catch (error) {
      rollback();
      throw new Error(`Unable to save moderation data "${this.filePath}": ${(error as Error).message}`, { cause: error });
    }
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeIp(address: string): string | undefined {
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, '');
  return isIP(normalized) ? normalized : undefined;
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim().slice(0, 160);
  return normalized || 'Banned by an operator';
}
