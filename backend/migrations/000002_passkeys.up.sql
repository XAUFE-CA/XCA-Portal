BEGIN;

ALTER TABLE users
    ADD COLUMN webauthn_user_handle bytea CHECK (octet_length(webauthn_user_handle) = 32);
CREATE UNIQUE INDEX users_webauthn_user_handle ON users (webauthn_user_handle)
    WHERE webauthn_user_handle IS NOT NULL;

ALTER TABLE sessions ADD COLUMN otp_verified_at timestamptz;

ALTER TABLE auth_operations
    DROP CONSTRAINT auth_operations_kind_check,
    ADD CONSTRAINT auth_operations_kind_check CHECK (kind IN ('verify', 'logout', 'abandon', 'passkey_manage'));

CREATE TABLE passkey_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    rp_id text NOT NULL CHECK (char_length(rp_id) BETWEEN 1 AND 253),
    credential_id bytea NOT NULL CHECK (octet_length(credential_id) BETWEEN 1 AND 1023),
    public_key bytea NOT NULL CHECK (octet_length(public_key) > 0),
    sign_count bigint NOT NULL CHECK (sign_count BETWEEN 0 AND 4294967295),
    backup_eligible boolean NOT NULL,
    backup_state boolean NOT NULL,
    uv_initialized boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    label text CHECK (char_length(label) BETWEEN 1 AND 64),
    CHECK (backup_eligible OR NOT backup_state),
    UNIQUE (rp_id, credential_id)
);
CREATE INDEX passkey_credentials_active_user ON passkey_credentials (user_id, rp_id)
    WHERE revoked_at IS NULL;
CREATE INDEX passkey_credentials_user_rp ON passkey_credentials (user_id, rp_id);

CREATE TABLE passkey_operation_effects (
    operation_id uuid PRIMARY KEY REFERENCES auth_operations(id),
    actor_session_digest bytea NOT NULL CHECK (octet_length(actor_session_digest) = 32),
    credential_record_id uuid NOT NULL REFERENCES passkey_credentials(id),
    effect text NOT NULL CHECK (effect IN ('registration', 'revocation'))
);

CREATE TABLE passkey_challenges (
    flow_id bytea PRIMARY KEY CHECK (octet_length(flow_id) = 32),
    kind text NOT NULL,
    rp_id text NOT NULL CHECK (char_length(rp_id) BETWEEN 1 AND 253),
    origin text NOT NULL CHECK (origin <> ''),
    ceremony_version smallint NOT NULL CHECK (ceremony_version > 0),
    session_data jsonb NOT NULL CHECK (jsonb_typeof(session_data) = 'object'),
    user_id uuid REFERENCES users(id),
    session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK ((kind = 'registration' AND user_id IS NOT NULL AND session_id IS NOT NULL)
        OR (kind = 'authentication' AND user_id IS NULL AND session_id IS NULL))
);
CREATE INDEX passkey_challenges_expiry ON passkey_challenges (expires_at);
CREATE INDEX passkey_challenges_session ON passkey_challenges (session_id) WHERE session_id IS NOT NULL;

COMMIT;
