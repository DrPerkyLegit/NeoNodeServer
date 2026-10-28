import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ModerationStore } from '../src/server/moderation';
import { loadPlugins } from '../src/server/plugin-loader';

test('operator, username ban, and IP ban data persist and normalize lookups', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'neo-moderation-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'moderation.json');
  const store = await ModerationStore.load(filePath, ['OriginalOp']);
  await store.setOperator('NewOp', true);
  await store.banUsername('BadPlayer', 'test reason');
  await store.banIp('127.0.0.2', 'test network ban');

  const loaded = await ModerationStore.load(filePath);
  assert.equal(loaded.isOperator('newop'), true);
  assert.equal(loaded.isOperator('originalop'), true);
  assert.equal(loaded.isUsernameBanned('BADPLAYER'), 'test reason');
  assert.equal(loaded.isIpBanned('127.0.0.2'), 'test network ban');
  assert.equal(loaded.isIpBanned('invalid'), undefined);
  await loaded.pardonUsername('badplayer');
  await loaded.pardonIp('127.0.0.2');
  assert.equal(loaded.isUsernameBanned('badplayer'), undefined);
  assert.equal(loaded.isIpBanned('127.0.0.2'), undefined);
});

test('CommonJS plugin examples load through the configured plugin loader', async () => {
  const plugins = await loadPlugins(join(process.cwd(), 'examples', 'plugins'));
  assert.deepEqual(plugins.map((plugin) => plugin.name), ['lobby-protection']);
});
