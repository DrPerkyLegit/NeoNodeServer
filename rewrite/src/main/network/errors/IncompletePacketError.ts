export class IncompletePacketError extends Error {
  constructor() {
    super('Incomplete packet');
    this.name = 'IncompletePacketError';
  }
}