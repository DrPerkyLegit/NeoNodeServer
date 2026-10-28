import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PluginManager } from '../main/plugin/PluginManager';

test('plugin manager loads in filename order, dispatches events, and disables in reverse order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neo-plugin-manager-test-'));
  const directory = path.join(root, 'plugins');
  const calls: string[] = [];
  const manager = new PluginManager(directory, { calls });
  try {
    await mkdir(directory);
    await writeFile(path.join(directory, 'ignored.txt'), 'not a plugin');
    await writeFile(path.join(directory, 'a.cjs'), `
      module.exports = {
        name: 'first',
        async onEnable(api) {
          api.server.calls.push('enable-first');
          api.on('probe', (event) => {
            api.server.calls.push('first');
            event.value += 1;
          });
          api.once('once', () => api.server.calls.push('once'));
        },
        async onDisable(api) { api.server.calls.push('disable-first'); }
      };
    `);
    await writeFile(path.join(directory, 'b.js'), `
      module.exports = {
        name: 'second',
        onEnable(api) {
          api.server.calls.push('enable-second');
          api.on('probe', (event) => {
            api.server.calls.push('second');
            event.value += 2;
          });
        },
        onDisable(api) { api.server.calls.push('disable-second'); }
      };
    `);

    await manager.loadAll();
    const probe = manager.emit('probe', { value: 0 });
    manager.emit('once');
    manager.emit('once');
    assert.equal(probe.value, 3);
    assert.deepEqual(manager.loadedPluginNames, ['first', 'second']);
    await manager.disableAll();
    assert.deepEqual(calls, [
      'enable-first',
      'enable-second',
      'first',
      'second',
      'once',
      'disable-second',
      'disable-first',
    ]);
    assert.equal(manager.hasListeners('probe'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
