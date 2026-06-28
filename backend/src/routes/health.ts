import { Router } from "express";

export const healthRouter = Router();

// Liveness/readiness probe. Intentionally does no DB or gateway work: migrations
// complete before the server listens, so a 200 means the process is up.
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
