import { Router } from "express";
import type { AuthProvider } from "../auth/index.js";
import { resolveUser } from "../middleware/resolveUser.js";
import type { UserRepository } from "../storage/userRepository.js";

/**
 * The repositories the dashboard API reads from. Handlers delegate to these —
 * no business logic lives in routes (PRD §5.1). Grows per milestone.
 */
export interface DashboardDeps {
  users: UserRepository;
}

/**
 * The authenticated read-only dashboard API under /api/dashboard (PRD §5.4).
 * Every route runs behind authMiddleware (verifies the token, sets `req.user`)
 * and resolveUser (maps to `req.userId`, enforces the v1 owner-only gate) — so
 * handlers can assume a resolved, authorized user.
 */
export function dashboardRouter(auth: AuthProvider, deps: DashboardDeps): Router {
  const router = Router();
  router.use("/api/dashboard", auth.authMiddleware, resolveUser(deps.users));

  // Who am I — the shell's session probe (M0).
  router.get("/api/dashboard/me", (req, res) => {
    const user = req.appUser!;
    res.json({
      user: {
        id: user.id,
        displayName: user.display_name,
        isOwner: user.is_owner,
      },
    });
  });

  return router;
}
