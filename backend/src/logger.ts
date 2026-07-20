import type { IncomingMessage, ServerResponse } from "node:http";
import { pino, type Level } from "pino";
import { pinoHttp } from "pino-http";

// The logger is the one piece of infrastructure that exists beneath the DI graph — it
// is imported by nearly every module, so it can't receive injected config the way the
// agent/Discord layers do. It reads the two values it needs straight from process.env
// (no Zod validation): these only tune log verbosity/format, never behavior, and the
// validated `loadEnv()` still fails fast on real misconfiguration at the composition root.
const NODE_ENV = process.env.NODE_ENV ?? "development";
const LOG_LEVEL = process.env.LOG_LEVEL;

// Redact secrets from request logs.
const redact = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "token",
  "*.password",
  "*.token",
];

function resolveLevel(): string {
  if (NODE_ENV === "test") return "silent";
  if (LOG_LEVEL) return LOG_LEVEL;
  return NODE_ENV === "production" ? "info" : "debug";
}

// Pretty output only in local dev. In production (and tests) we emit plain JSON
// with no transport, so nothing relies on pino's worker-thread machinery — which
// also keeps the tsup bundle self-contained.
const usePretty = NODE_ENV === "development";

function isHealthProbe(req: IncomingMessage): boolean {
  const url = req.url ?? "";
  return url === "/health" || url.startsWith("/health?");
}

function httpLogLevel(res: ServerResponse, err: Error | undefined, quiet = false): Level {
  if (res.statusCode >= 500 || err) return "error";
  if (res.statusCode >= 400) return "warn";
  return quiet ? "debug" : "info";
}

export const logger = pino({
  level: resolveLevel(),
  redact,
  ...(usePretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(req, res, err) {
    return httpLogLevel(res, err, isHealthProbe(req));
  },
});
