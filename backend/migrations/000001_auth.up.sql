CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
    login_name text NOT NULL UNIQUE CHECK (login_name COLLATE "C" ~ '^[a-z0-9][a-z0-9_-]{0,127}$' AND login_name NOT IN ('guest', 'anonymous', 'admin', 'administrator', 'root', 'system', 'support', 'null')),
    display_name text NOT NULL CHECK (display_name <> ''),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
    login_name text NOT NULL CHECK (login_name COLLATE "C" ~ '^[a-z0-9][a-z0-9_-]{0,127}$' AND login_name NOT IN ('guest', 'anonymous', 'admin', 'administrator', 'root', 'system', 'support', 'null')),
    display_name text NOT NULL CHECK (display_name <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    used_at timestamptz,
    user_id uuid REFERENCES users(id),
    active_slot boolean NOT NULL DEFAULT true,
    CHECK (expires_at > created_at),
    CHECK (NOT active_slot OR (revoked_at IS NULL AND used_at IS NULL)),
    CHECK ((used_at IS NULL) = (user_id IS NULL)),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX invitations_active_email ON invitations (email) WHERE active_slot;
CREATE UNIQUE INDEX invitations_active_login_name ON invitations (login_name) WHERE active_slot;
CREATE INDEX invitations_expiry ON invitations (expires_at) WHERE active_slot;

CREATE TABLE email_challenges (
    flow_id text PRIMARY KEY CHECK (flow_id <> ''),
    email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
    otp_digest bytea NOT NULL CHECK (octet_length(otp_digest) = 32),
    key_version integer NOT NULL CHECK (key_version > 0),
    invitation_id uuid REFERENCES invitations(id),
    user_id uuid REFERENCES users(id),
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    CHECK (invitation_id IS NULL OR user_id IS NULL),
    CHECK (expires_at > created_at)
);
CREATE INDEX email_challenges_expiry ON email_challenges (expires_at);
CREATE INDEX email_challenges_open_email ON email_challenges (email) WHERE used_at IS NULL;
CREATE INDEX email_challenges_invitation ON email_challenges (invitation_id) WHERE invitation_id IS NOT NULL;
CREATE INDEX email_challenges_user ON email_challenges (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_digest bytea NOT NULL UNIQUE CHECK (octet_length(session_digest) > 0),
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE auth_rate_limits (
    scope text NOT NULL CHECK (scope <> ''),
    subject_digest bytea NOT NULL CHECK (octet_length(subject_digest) = 32),
    window_start timestamptz NOT NULL,
    count integer NOT NULL CHECK (count >= 0),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (scope, subject_digest, window_start),
    CHECK (expires_at > window_start)
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits (expires_at);
