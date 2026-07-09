import type { RequestHandler } from "express";
import type { UserRepository, UserRow } from "../storage/userRepository.js";

// Extend Express Request with the resolved app user (the auth principal itself is
// added by the auth provider — see auth/index.ts).
declare global {
  namespace Express {
    interface Request {
      /** The app-side users.id every repository scopes by. Never trusted from the client. */
      userId?: string;
      appUser?: UserRow;
    }
  }
}

/**
 * Map the verified auth principal (`req.user`, set by authMiddleware) to an aivo
 * `users` row and set `req.userId`/`req.appUser` for downstream handlers.
 *
 * Aivo's twist on workbench's upsertByAuthSub: users are keyed by Discord id and
 * provisioned from Discord messages, so a web login never *creates* a row — it
 * *links* one. On first login, a principal with the `owner` app role (or the
 * homectl admin) claims the `is_owner` row by filling its reserved `auth_sub`
 * seam (migration 001); later logins find the row by `auth_sub` directly.
 *
 * M0 ships owner-only (PRD §8 Q2): any principal that neither owns nor can claim
 * the owner row gets 403. Relaxing this for household members later means adding
 * a lookup/link path for non-owner rows here — handlers already scope by
 * `req.userId` and need no change.
 *
 * The owner-claim signal is the aivo app role (`owner`) the sidecar injects as
 * `X-Homectl-Role`. homectl-auth's global `isAdmin` is not projected through the
 * sidecar, so to let someone claim the owner row they must hold the `owner` role
 * in aivo's apps.json entry — least privilege, no cross-app super-admin path.
 */
export function resolveUser(users: UserRepository): RequestHandler {
  return async (req, res, next) => {
    try {
      const principal = req.user;
      if (!principal) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const linked = await users.findByAuthSub(principal.id);
      if (linked) {
        if (!linked.is_owner) {
          res.status(403).json({ error: "forbidden", reason: "dashboard is owner-only in v1" });
          return;
        }
        req.userId = linked.id;
        req.appUser = linked;
        next();
        return;
      }

      const mayClaimOwner = principal.role === "owner";
      if (!mayClaimOwner) {
        res.status(403).json({ error: "forbidden", reason: "dashboard is owner-only in v1" });
        return;
      }

      const owner = await users.linkOwnerAuthSub(principal.id);
      if (!owner) {
        // Either no is_owner row exists yet (the owner has never messaged on
        // Discord, which is what provisions it) or another subject already
        // claimed it. Both are a 403, not a 500 — the request was understood.
        res.status(403).json({
          error: "forbidden",
          reason: "owner user not provisioned or already linked to another login",
        });
        return;
      }
      req.userId = owner.id;
      req.appUser = owner;
      next();
    } catch (err) {
      next(err);
    }
  };
}
