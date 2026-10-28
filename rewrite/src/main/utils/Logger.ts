export type LogLevel = "info" | "warn" | "error" | "debug" | "success";
export class Logger {
    private static readonly reset = "\x1b[0m";
    private static readonly gray = "\x1b[90m";
    private static readonly colors: Record<LogLevel, string> = {
        info: "\x1b[34m", warn: "\x1b[33m", error: "\x1b[31m", debug: "\x1b[35m",
        success: "\x1b[32m"
    };

    private static log(level: LogLevel, ...args: unknown[]): void {
        const time = new Date().toLocaleTimeString("en-GB", { hour12: false });

        const color = this.colors[level];

        console.log(`${this.gray}[${time}]${this.reset} ${color}[${level.toUpperCase()}]${this.reset}`, ...args);
    }

    static info(...args: unknown[]): void {
        this.log("info", ...args);
    }

    static warn(...args: unknown[]): void {
        this.log("warn", ...args);
    }

    static error(...args: unknown[]): void {
        this.log("error", ...args);
    }

    static debug(...args: unknown[]): void {
        this.log("debug", ...args);
    }

    static success(...args: unknown[]): void {
        this.log("success", ...args);
    }
}