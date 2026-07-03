import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Me } from "../api/client.js";
import { useApi } from "../api/useApi.js";
import { auth } from "../auth/auth.js";

const NAV_ITEMS = [
  { to: "/", label: "Overview" },
  { to: "/usage", label: "Usage & Budget" },
  { to: "/models", label: "Models" },
  { to: "/memory", label: "Memory & Profiles" },
  { to: "/digests", label: "Digests" },
  { to: "/activity", label: "Activity Log" },
  { to: "/settings", label: "Settings" },
];

/**
 * The app shell: fixed sidebar on desktop, hamburger-toggled drawer on phones
 * (PRD §5.5 — desktop-first, mobile-usable; 44px tap targets in styles.css).
 */
export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const me = useApi<Me>("/api/dashboard/me");

  const displayName = me.data?.user.displayName ?? "…";

  return (
    <div className="shell">
      <header className="topbar">
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          ☰
        </button>
        <span className="brand">aivo</span>
        <span className="topbar-user">{displayName}</span>
      </header>

      <nav className={`sidebar ${navOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">aivo</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                onClick={() => setNavOpen(false)}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div className="sidebar-user" title={me.data?.user.id}>
            {displayName}
            {me.data?.user.isOwner ? <span className="badge">owner</span> : null}
          </div>
          <button type="button" className="logout" onClick={() => void auth.logout()}>
            Log out
          </button>
        </div>
      </nav>

      {navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <main className="content">
        {me.error ? <div className="error-banner">{me.error}</div> : null}
        <Outlet />
      </main>
    </div>
  );
}
