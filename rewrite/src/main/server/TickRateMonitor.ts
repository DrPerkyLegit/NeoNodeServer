const SAMPLE_WINDOW_MS = 10_000;
const MAX_TPS = 20;

export class TickRateMonitor {
  private lastTickAt: number | undefined;
  private readonly intervals: Array<{ readonly timestamp: number; readonly duration: number }> = [];

  recordTick(timestamp: number): void {
    if (!Number.isFinite(timestamp)) throw new RangeError(`Invalid tick timestamp: ${timestamp}`);
    if (this.lastTickAt !== undefined) {
      const duration = timestamp - this.lastTickAt;
      if (duration < 0) throw new RangeError('Tick timestamps must be nondecreasing');
      if (duration > 0) this.intervals.push({ timestamp, duration });
    }
    this.lastTickAt = timestamp;
    this.prune(timestamp);
  }

  getTps(now = this.lastTickAt ?? 0): number {
    if (!Number.isFinite(now)) throw new RangeError(`Invalid TPS query timestamp: ${now}`);
    this.prune(now);
    if (this.intervals.length === 0) return 0;
    const averageInterval = this.intervals.reduce((sum, sample) => sum + sample.duration, 0) /
      this.intervals.length;
    return Math.min(MAX_TPS, 1000 / averageInterval);
  }

  private prune(now: number): void {
    while (this.intervals.length > 0 && now - this.intervals[0].timestamp > SAMPLE_WINDOW_MS) {
      this.intervals.shift();
    }
  }
}
