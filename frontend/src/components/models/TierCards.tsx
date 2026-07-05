import { DEGRADATION_META } from "../../lib/palette.js";
import type { ModelsOverview } from "../../lib/models.js";

/**
 * M-2 + M-3: which model fills each tier role, and how the user's preference
 * resolves after budget degradation. When degradation forces a different tier
 * than requested, the card says so in plain language instead of silently
 * showing a tier the user didn't pick.
 */
export function TierCards({ overview }: { overview: ModelsOverview }) {
  const degraded = overview.effectiveTier !== overview.requestedTier;
  const status = DEGRADATION_META[overview.degradation.state];
  return (
    <div className="stat-grid">
      <div className="card stat-tile">
        <div className="stat-label">Cheap tier</div>
        <div className="stat-value stat-model">{overview.tiers.cheap ?? "—"}</div>
        <div className="stat-detail">ranking, classification, degraded chat</div>
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Premium tier</div>
        <div className="stat-value stat-model">{overview.tiers.premium ?? "—"}</div>
        <div className="stat-detail">real conversation when budget allows</div>
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Your preference</div>
        <div className="stat-value">{overview.tierPreference}</div>
        <div className="stat-detail">
          {overview.tierPreference === "auto"
            ? `auto resolves to the ${overview.requestedTier} tier`
            : "set via Discord (settings)"}
        </div>
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Effective tier</div>
        <div
          className="stat-value status-chip"
          style={degraded ? { color: status.color } : undefined}
        >
          {degraded ? <span aria-hidden="true">{status.icon}</span> : null} {overview.effectiveTier}
        </div>
        <div className="stat-detail">
          {degraded ? overview.degradation.description : "matches your preference"}
        </div>
      </div>
    </div>
  );
}
