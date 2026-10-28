/**
 * research-scope-mcp — structured logging
 *
 * One JSON object per line, always on stderr. stdout is reserved for the MCP
 * stdio protocol: a single stray byte there corrupts the client's JSON-RPC
 * stream, so nothing in this server may ever log to stdout.
 *
 * Level is set with RESEARCH_SCOPE_LOG_LEVEL = debug | info | warn | error | silent
 * (default: info). Each line carries `ts`, `level`, `event`, plus event fields.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
export type LogLevel = Exclude<keyof typeof LEVELS, "silent">;

function resolveThreshold(): number {
  const raw = (process.env.RESEARCH_SCOPE_LOG_LEVEL ?? "info").toLowerCase();
  if (raw in LEVELS) return LEVELS[raw as keyof typeof LEVELS];
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      event: "log.invalid_level",
      value: raw,
      hint: "RESEARCH_SCOPE_LOG_LEVEL must be one of debug, info, warn, error, silent; using info",
    }) + "\n"
  );
  return LEVELS.info;
}

const threshold = resolveThreshold();

/** Errors don't JSON.stringify usefully; flatten them (and their `cause`) to plain fields. */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  const cause = (err as Error & { cause?: unknown }).cause;
  const code = (err as Error & { code?: unknown }).code;
  return {
    name: err.name,
    message: err.message,
    ...(code !== undefined ? { code } : {}),
    ...(cause !== undefined ? { cause: serializeError(cause) } : {}),
  };
}

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  const record: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  for (const [k, v] of Object.entries(fields)) {
    record[k] = v instanceof Error ? serializeError(v) : v;
  }
  process.stderr.write(JSON.stringify(record) + "\n");
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
