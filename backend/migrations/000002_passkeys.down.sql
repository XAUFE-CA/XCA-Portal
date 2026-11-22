BEGIN;

DROP TABLE passkey_operation_effects;
DROP TABLE passkey_challenges;
DROP TABLE passkey_credentials;

-- Keep management operation IDs fenced after reverting their operation kind.
-- 回退操作类型后保留管理操作标识的取消屏障。
UPDATE auth_operations SET kind = 'abandon', state = 'abandoned' WHERE kind = 'passkey_manage';
ALTER TABLE auth_operations
    DROP CONSTRAINT auth_operations_kind_check,
    ADD CONSTRAINT auth_operations_kind_check CHECK (kind IN ('verify', 'logout', 'abandon'));

ALTER TABLE sessions DROP COLUMN otp_verified_at;
ALTER TABLE users DROP COLUMN webauthn_user_handle;

COMMIT;
