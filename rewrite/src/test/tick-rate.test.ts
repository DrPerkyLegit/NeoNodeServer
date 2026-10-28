import assert from 'node:assert/strict';
import test from 'node:test';
import { TickRateMonitor } from '../main/server/TickRateMonitor';

test('tick-rate monitor reports measured TPS and caps at the server target', () => {
  const monitor = new TickRateMonitor();
  assert.equal(monitor.getTps(), 0);

  monitor.recordTick(0);
  monitor.recordTick(50);
  assert.equal(monitor.getTps(), 20);

  monitor.recordTick(150);
  assert.equal(monitor.getTps(), 1000 / 75);
});

test('tick-rate monitor expires old samples and rejects backwards time', () => {
  const monitor = new TickRateMonitor();
  monitor.recordTick(0);
  monitor.recordTick(50);
  assert.equal(monitor.getTps(10_051), 0);
  assert.throws(() => monitor.recordTick(49), /nondecreasing/);
});
