import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { auth } from "./auth/auth.js";
import { Layout } from "./components/Layout.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { DigestsPage } from "./pages/DigestsPage.js";
import { MemoryPage } from "./pages/MemoryPage.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { UsagePage } from "./pages/UsagePage.js";

/**
 * Gate the whole app on an access token: bootstrap exchanges the homectl-auth
 * refresh cookie for an in-memory token; without one we bounce through the
 * backend's /auth/login (full-page navigation, so this render never completes).
 * With VITE_DISABLE_AUTH the dev auth client bootstraps unconditionally.
 */
export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void auth.bootstrap().then((ok) => {
      if (!ok) {
        auth.login(window.location.pathname + window.location.search);
        return;
      }
      setReady(true);
    });
  }, []);

  if (!ready) {
    return <div className="boot-splash">Signing in…</div>;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/digests" element={<DigestsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<OverviewPage />} />
      </Route>
    </Routes>
  );
}
