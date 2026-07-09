import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { DigestsPage } from "./pages/DigestsPage.js";
import { MemoryPage } from "./pages/MemoryPage.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { UsagePage } from "./pages/UsagePage.js";

/**
 * The shell renders straight away: no token bootstrap. Under the homectl-auth-proxy
 * sidecar the SPA is auth-agnostic — the sidecar only serves this HTML to an
 * already-authenticated session (an unauthenticated top-level navigation is 302'd
 * to central login before the shell loads), so by the time this runs there is a
 * session. If it later expires, the first API call returns 401 and the fetch layer
 * bounces through a full page load (see api/client.ts). In dev the backend's dev
 * provider authenticates every request.
 */
export function App() {
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
