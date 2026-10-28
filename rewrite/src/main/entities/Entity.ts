export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class Entity {
  constructor(
    public readonly id: number,
    public x = 0,
    public y = 0,
    public z = 0,
    public yaw = 0,
    public pitch = 0,
    public health = 20,
  ) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError(`Invalid entity ID: ${id}`);
  }

  get position(): Position {
    return { x: this.x, y: this.y, z: this.z };
  }

  teleport(position: Position, yaw = this.yaw, pitch = this.pitch): void {
    if (![position.x, position.y, position.z, yaw, pitch].every(Number.isFinite)) {
      throw new RangeError('Entity position and rotation must be finite');
    }
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
