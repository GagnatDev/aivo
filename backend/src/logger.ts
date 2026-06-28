import { pino } from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";

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
  if (env.NODE_ENV === "test") return "silent";
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  return env.NODE_ENV === "production" ? "info" : "debug";
}

// Pretty output only in local dev. In production (and tests) we emit plain JSON
// with no transport, so nothing relies on pino's worker-thread machinery — which
// also keeps the tsup bundle self-contained.
const usePretty = env.NODE_ENV === "development";

export const logger = pino({
  level: resolveLevel(),
  redact,
  ...(usePretty
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export const httpLogger = pinoHttp({ logger });
