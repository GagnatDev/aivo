-- Up Migration

-- The single connection to unforked, the family meal planner (unforked
-- docs/aivo-integration.md). Always at most one row — one household, one
-- unforked account — so the pk is a CHECKed constant like youtube_account.
--
-- Unlike the YouTube refresh token (which lives in deployment secrets), the
-- unforked API key IS stored here: the owner registers it from the dashboard's
-- Settings page at runtime, not at deploy time. The key is read-only on the
-- unforked side and only usable from inside the cluster (unforked's machine
-- API is ingress-less and NetworkPolicy-restricted to aivo's pods), which
-- bounds the blast radius of a database leak.
CREATE TABLE unforked_connection (
    id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    api_key              TEXT NOT NULL,
    -- Echoed from unforked's /machine/v1/me at registration, for display.
    owner_email          TEXT,
    key_name             TEXT,
    connected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
