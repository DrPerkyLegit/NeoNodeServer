import path from 'node:path';

export class PathUtils {
    public static getWorldsFolder(): string {
        return path.join(process.cwd(), 'worlds');
    }
}