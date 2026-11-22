package auth

import (
	"context"
	"crypto/subtle"
	"errors"

	"github.com/jackc/pgx/v5"
)

func recordPasskeyEffect(ctx context.Context, tx pgx.Tx, operationID string, digest []byte, recordID, effect string) error {
	_, err := tx.Exec(ctx, `INSERT INTO passkey_operation_effects (operation_id, actor_session_digest, credential_record_id, effect)
		VALUES ($1, $2, $3, $4)`, operationID, digest, recordID, effect)
	if err != nil {
		return ErrUnavailable
	}
	return nil
}

func abandonPasskeyEffect(ctx context.Context, tx pgx.Tx, operationID, token string, allowed bool) (string, error) {
	digest, ok := sessionDigest(token)
	if !allowed || !ok {
		return "", ErrPasskeyNotFound
	}
	var actor []byte
	var recordID, effect string
	err := tx.QueryRow(ctx, `SELECT actor_session_digest, credential_record_id::text, effect
		FROM passkey_operation_effects WHERE operation_id = $1`, operationID).Scan(&actor, &recordID, &effect)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrPasskeyNotFound
	}
	if err != nil {
		return "", ErrUnavailable
	}
	// Only the originating cookie can authorize compensation, even after it stops authenticating requests.
	// 只有发起操作的 Cookie 可授权补偿，即使它已不能用于认证请求。
	if subtle.ConstantTimeCompare(actor, digest) != 1 {
		return "", ErrPasskeyNotFound
	}
	switch effect {
	case "registration":
		if _, err := tx.Exec(ctx, `UPDATE passkey_credentials SET revoked_at = clock_timestamp()
			WHERE id = $1 AND revoked_at IS NULL`, recordID); err != nil {
			return "", ErrUnavailable
		}
		return "registration_revoked", nil
	case "revocation":
		return "revocation_committed", nil
	default:
		return "", ErrUnavailable
	}
}
