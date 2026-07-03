import express, { type Express } from "express";
import { httpLogger } from "./logger.js";
import { healthRouter } from "./routes/health.js";
import { youtubeOauthRouter, type YoutubeOauthRouteConfig } from "./routes/youtubeOauth.js";

export interface AppOptions {
  /** Mounts the one-time YouTube OAuth handshake when the client config exists. */
  youtubeOauth?: YoutubeOauthRouteConfig;
}

/**
 * Assemble the Express application. In v1 the only HTTP surface is `/health`
 * (k8s probes) and the one-time YouTube OAuth callback — all real interaction
 * happens over the Discord gateway. Returns the app without listening so it can
 * be driven in-process by supertest.
 */
export function buildApp(options: AppOptions = {}): Express {
  const app = express();
  // Behind the K8s Ingress (when one exists): trust X-Forwarded-* for req.ip.
  app.set("trust proxy", true);
  app.use(httpLogger);
  app.use(express.json({ limit: "1mb" }));
  app.use(healthRouter);
  if (options.youtubeOauth) app.use(youtubeOauthRouter(options.youtubeOauth));
  return app;
}
