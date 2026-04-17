export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly name: string;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(name: string): Logger;
}

export interface LoggerOptions {
  /** Minimum level to emit. Levels below this are silenced. Default: 'info'. */
  level?: LogLevel;
  /** Custom sink — defaults to console.warn/error. For testing, pass an array collector. */
  sink?: (entry: LogEntry) => void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function defaultSink(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] [${entry.name}]`;
  const ctx = Object.keys(entry.context).length ? entry.context : undefined;

  if (entry.level === 'error') {
    console.error(prefix, entry.message, ...(ctx ? [ctx] : []));
  } else if (entry.level === 'warn') {
    console.warn(prefix, entry.message, ...(ctx ? [ctx] : []));
  }
  // debug/info are no-ops in production unless a custom sink is provided
}

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const { level = 'info', sink = defaultSink } = options;
  const minRank = LEVEL_RANK[level];

  function emit(lvl: LogLevel, message: string, context: Record<string, unknown> = {}): void {
    if (LEVEL_RANK[lvl] < minRank) return;
    sink({
      level: lvl,
      name,
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    child: (childName) => createLogger(`${name}:${childName}`, { level, sink }),
  };
}

/** Collect log entries into an array — for use in tests. */
export function createTestLogger(name = 'test'): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = createLogger(name, {
    level: 'debug',
    sink: (entry) => entries.push(entry),
  });
  return Object.assign(logger, { entries });
}
