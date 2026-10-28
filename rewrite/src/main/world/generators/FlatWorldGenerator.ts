import { Chunk } from '../Chunk';

export interface WorldGenerator {
  readonly name: string;
  generate(chunkX: number, chunkZ: number, seed: bigint): Chunk;
}

export class FlatWorldGenerator implements WorldGenerator {
  readonly name = 'flat';

  generate(chunkX: number, chunkZ: number, _seed: bigint): Chunk {
    const chunk = new Chunk(chunkX, chunkZ);
    chunk.biomes.fill(1);
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        chunk.setBlock(x, 0, z, 7);
        chunk.setBlock(x, 1, z, 3);
        chunk.setBlock(x, 2, z, 3);
        chunk.setBlock(x, 3, z, 2);
      }
    }
    return chunk;
  }
}
