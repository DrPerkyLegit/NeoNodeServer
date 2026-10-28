import { connect, type Socket } from 'node:net';
import { DisconnectPacket } from '../main/network/packets/DisconnectPacket';
import { LoginPacket } from '../main/network/packets/LoginPacket';
import { PreLoginPacket } from '../main/network/packets/PreLoginPacket';
import { MovePlayerPacket } from '../main/network/packets/MovePlayerPacket';
import { LEGACY_NETCODE_VERSION, LEGACY_PROTOCOL_VERSION, MAX_REMOTE_SMALL_ID, FIRST_REMOTE_SMALL_ID } from '../main/network/ProtocolConstants';

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 25565;
const DEFAULT_BOT_COUNT = 100;
const DEFAULT_HOLD_SECONDS = 60;
const BOT_MOVEMENT_INTERVAL_MS = 250;
const BOT_MOVEMENT_STEP = 0.35;
const BOT_MOVEMENT_RADIUS = 24;
const movementStops = new WeakMap<Socket, () => void>();

interface LoadTestOptions {
  readonly host: string;
  readonly port: number;
  readonly count: number;
  readonly prefix: string;
  readonly holdSeconds: number;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const botNames = Array.from({ length: options.count }, (_, index) =>
    `${options.prefix}${String(index + 1).padStart(3, '0')}`,
  );
  const attempts = await Promise.allSettled(
    botNames.map((name) => connectBot(options.host, options.port, name)),
  );
  const sockets = attempts.flatMap((attempt) => attempt.status === 'fulfilled' ? [attempt.value] : []);
  const failures = attempts.flatMap((attempt, index) =>
    attempt.status === 'rejected'
      ? [`${botNames[index]}: ${errorMessage(attempt.reason)}`]
      : [],
  );

  console.log(`Connected ${sockets.length}/${options.count} bots to ${options.host}:${options.port}.`);
  for (const failure of failures.slice(0, 10)) console.error(`  ${failure}`);
  if (failures.length > 10) console.error(`  ...and ${failures.length - 10} more failure(s).`);
  if (sockets.length !== options.count) {
    await closeBots(sockets);
    throw new Error(
      `Only ${sockets.length} bots joined. Ensure server.properties maxPlayers is at least ${options.count}.`,
    );
  }

  console.log(
    options.holdSeconds === 0
      ? 'Bots will remain connected until Ctrl+C.'
      : `Holding connections for ${options.holdSeconds} second(s).`,
  );
  if (options.holdSeconds === 0) {
    await waitForSignal();
  } else {
    await Promise.race([delay(options.holdSeconds * 1000), waitForSignal()]);
  }
  await closeBots(sockets);
  console.log('Load-test bots disconnected.');
}

function connectBot(host: string, port: number, username: string): Promise<Socket> {
  const socket = connect({ host, port });
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    let smallIdReceived = false;
    let stage: 'pre-login' | 'login' | 'joined' = 'pre-login';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Timed out during login')), 30_000);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(socket);
      }
    };

    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (stage !== 'joined') finish(new Error('Connection closed before login completed'));
    });
    socket.on('data', (data) => {
      pending = Buffer.concat([pending, typeof data === 'string' ? Buffer.from(data) : data]);
      try {
        if (!smallIdReceived) {
          if (pending.length === 0) return;
          const smallId = pending.readUInt8(0);
          pending = pending.subarray(1);
          if (smallId < FIRST_REMOTE_SMALL_ID || smallId > MAX_REMOTE_SMALL_ID) {
            throw new Error(`Server assigned invalid small ID ${smallId}`);
          }
          smallIdReceived = true;
          const preLogin = new PreLoginPacket();
          preLogin.netcodeVersion = LEGACY_NETCODE_VERSION;
          preLogin.loginKey = username;
          socket.write(framePacket(preLogin.encode()));
        }

        while (pending.length >= 4) {
          const frameLength = pending.readUInt32BE(0);
          if (frameLength < 1 || frameLength > MAX_FRAME_BYTES) {
            throw new Error(`Server sent invalid frame length ${frameLength}`);
          }
          if (pending.length < frameLength + 4) break;
          const packetData = pending.subarray(4, frameLength + 4);
          pending = pending.subarray(frameLength + 4);
          const packetId = packetData.readUInt8(0);

          if (stage === 'pre-login' && packetId === 2) {
            stage = 'login';
            const login = new LoginPacket();
            login.clientVersion = LEGACY_PROTOCOL_VERSION;
            login.username = username;
            login.levelType = 'flat';
            socket.write(framePacket(login.encode()));
          } else if (stage === 'login' && packetId === 1) {
            stage = 'joined';
            startBotMovement(socket);
            finish();
          }
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function parseOptions(args: string[]): LoadTestOptions {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run test:load -- [host] [port] [count] [holdSeconds] [prefix]');
    console.log('Defaults: 127.0.0.1 25565 100 60 Bot (use holdSeconds=0 to wait for Ctrl+C)');
    console.log('Bots use unique in-game usernames and walk in random directions while connected.');
    process.exit(0);
  }
  if (args.length > 5) throw new Error('Too many arguments; use --help for usage.');

  const [host = DEFAULT_HOST, portValue, countValue, holdValue, prefix = 'Bot'] = args;
  const port = parseInteger(portValue, DEFAULT_PORT, 'port', 1, 65535);
  const count = parseInteger(countValue, DEFAULT_BOT_COUNT, 'count', 1, MAX_REMOTE_SMALL_ID - FIRST_REMOTE_SMALL_ID + 1);
  const holdSeconds = parseInteger(holdValue, DEFAULT_HOLD_SECONDS, 'holdSeconds', 0, 86_400);
  const suffixLength = String(count).length < 3 ? 3 : String(count).length;
  if (!/^[A-Za-z0-9_]{1,16}$/.test(prefix) || prefix.length + suffixLength > 16) {
    throw new Error('Bot prefix and numeric suffix must form a valid username of at most 16 characters.');
  }
  if (!host) throw new Error('Host must not be empty.');
  return { host, port, count, prefix, holdSeconds };
}

function parseInteger(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

async function closeBots(sockets: Socket[]): Promise<void> {
  await Promise.all(sockets.map((socket) => new Promise<void>((resolve) => {
    movementStops.get(socket)?.();
    if (socket.destroyed) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve();
    }, 2_000);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.end(framePacket(new DisconnectPacket(1).encode()));
  })));
}

function startBotMovement(socket: Socket): void {
  let x = 0.5;
  let z = 0.5;
  let heading = Math.random() * Math.PI * 2;
  let turnAt = Date.now() + randomTurnDelay();
  const timer = setInterval(() => {
    if (socket.destroyed || !socket.writable) {
      stop();
      return;
    }

    if (Date.now() >= turnAt) {
      heading += (Math.random() - 0.5) * Math.PI;
      turnAt = Date.now() + randomTurnDelay();
    }

    let nextX = x + Math.cos(heading) * BOT_MOVEMENT_STEP;
    let nextZ = z + Math.sin(heading) * BOT_MOVEMENT_STEP;
    if (Math.hypot(nextX, nextZ) > BOT_MOVEMENT_RADIUS) {
      heading = Math.atan2(-z, -x) + (Math.random() - 0.5);
      nextX = x + Math.cos(heading) * BOT_MOVEMENT_STEP;
      nextZ = z + Math.sin(heading) * BOT_MOVEMENT_STEP;
    }
    x = nextX;
    z = nextZ;

    const movement = new MovePlayerPacket('positionRotation');
    movement.x = x;
    movement.y = 4;
    movement.stance = 5.62;
    movement.z = z;
    movement.yaw = (heading * 180) / Math.PI;
    movement.onGround = true;
    socket.write(framePacket(movement.encode()));
  }, BOT_MOVEMENT_INTERVAL_MS);

  const stop = (): void => {
    clearInterval(timer);
    movementStops.delete(socket);
  };
  movementStops.set(socket, stop);
  socket.once('close', stop);
}

function randomTurnDelay(): number {
  return 2_000 + Math.random() * 3_000;
}

function framePacket(packet: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(packet.length + 4);
  frame.writeUInt32BE(packet.length, 0);
  packet.copy(frame, 4);
  return frame;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
