package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
)

const passkeyCeremonyVersion = 1

type PasskeyOptions struct {
	FlowID    string                                      `json:"flow_id"`
	PublicKey protocol.PublicKeyCredentialCreationOptions `json:"publicKey"`
}

type passkeyUser struct {
	handle            []byte
	name, displayName string
}

func (u passkeyUser) WebAuthnID() []byte                         { return u.handle }
func (u passkeyUser) WebAuthnName() string                       { return u.name }
func (u passkeyUser) WebAuthnDisplayName() string                { return u.displayName }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return nil }

func (p *Passkeys) Options(ctx context.Context, token string) (*PasskeyOptions, error) {
	tx, digest, err := p.begin(ctx, token)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	actor, err := p.lockActor(ctx, tx, digest, true)
	if err != nil {
		return nil, err
	}
	if len(actor.user.handle) == 0 {
		handle := make([]byte, 32)
		if _, err := rand.Read(handle); err != nil {
			return nil, ErrUnavailable
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET webauthn_user_handle = $1 WHERE id = $2`, handle, actor.userID); err != nil {
			return nil, ErrUnavailable
		}
		actor.user.handle = handle
	}
	exclusions, err := p.exclusions(ctx, tx, actor.userID)
	if err != nil {
		return nil, err
	}
	creation, session, err := p.webauthn.BeginRegistration(actor.user,
		webauthn.WithRegistrationOrigin(p.origin), webauthn.WithExclusions(exclusions))
	if err != nil {
		return nil, ErrUnavailable
	}
	sessionData, err := json.Marshal(session)
	if err != nil {
		return nil, ErrUnavailable
	}
	var flow [32]byte
	if _, err := rand.Read(flow[:]); err != nil {
		return nil, ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `INSERT INTO passkey_challenges
		(flow_id, kind, rp_id, origin, ceremony_version, session_data, user_id, session_id, created_at, expires_at)
		VALUES ($1, 'registration', $2, $3, $4, $5, $6, $7, statement_timestamp(),
			statement_timestamp() + make_interval(secs => $8))`,
		flow[:], p.rpID, p.origin, passkeyCeremonyVersion, sessionData, actor.userID, actor.sessionID, passkeyChallengeTTL.Seconds()); err != nil {
		return nil, ErrUnavailable
	}
	if err := p.commitRecent(ctx, tx, actor); err != nil {
		return nil, err
	}
	return &PasskeyOptions{FlowID: base64.RawURLEncoding.EncodeToString(flow[:]), PublicKey: creation.Response}, nil
}

func (p *Passkeys) exclusions(ctx context.Context, tx pgx.Tx, userID string) ([]protocol.CredentialDescriptor, error) {
	rows, err := tx.Query(ctx, `SELECT credential_id FROM passkey_credentials WHERE user_id = $1 AND rp_id = $2 ORDER BY created_at, id`, userID, p.rpID)
	if err != nil {
		return nil, ErrUnavailable
	}
	exclusions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (protocol.CredentialDescriptor, error) {
		item := protocol.CredentialDescriptor{Type: protocol.PublicKeyCredentialType}
		err := row.Scan(&item.CredentialID)
		return item, err
	})
	if err != nil {
		return nil, ErrUnavailable
	}
	return exclusions, nil
}

func (p *Passkeys) Verify(ctx context.Context, token, flowID, operationID string, response *protocol.CredentialCreationResponse) (PasskeySummary, error) {
	var item PasskeySummary
	if !ValidOperationID(operationID) || len(flowID) != 43 {
		return item, ErrInvalidRequest
	}
	flow, err := base64.RawURLEncoding.Strict().DecodeString(flowID)
	if err != nil || len(flow) != 32 {
		return item, ErrInvalidRequest
	}
	err = p.withMutation(ctx, token, operationID, func(tx pgx.Tx, actor passkeyActor, digest []byte) error {
		session, err := p.registrationSession(ctx, tx, flow, actor)
		if err != nil {
			return err
		}
		cred, err := p.verifyRegistration(actor.user, session, response)
		if err != nil {
			return err
		}
		item, err = p.storeCredential(ctx, tx, actor.userID, cred)
		if err != nil {
			return err
		}
		if err := recordPasskeyEffect(ctx, tx, operationID, digest, item.ID, "registration"); err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `UPDATE passkey_challenges SET consumed_at = clock_timestamp()
			WHERE flow_id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, flow)
		if err != nil {
			return ErrUnavailable
		}
		if result.RowsAffected() != 1 {
			return ErrPasskeyInvalidRegistration
		}
		return nil
	})
	if err != nil {
		return PasskeySummary{}, err
	}
	return item, nil
}

func (p *Passkeys) registrationSession(ctx context.Context, tx pgx.Tx, flow []byte, actor passkeyActor) (webauthn.SessionData, error) {
	var session webauthn.SessionData
	var data []byte
	err := tx.QueryRow(ctx, `SELECT session_data FROM passkey_challenges WHERE flow_id = $1
		AND kind = 'registration' AND rp_id = $2 AND origin = $3 AND ceremony_version = $4
		AND user_id = $5 AND session_id = $6 AND consumed_at IS NULL AND expires_at > clock_timestamp()
		FOR UPDATE`, flow, p.rpID, p.origin, passkeyCeremonyVersion, actor.userID, actor.sessionID).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return session, ErrPasskeyInvalidRegistration
	}
	if err != nil || json.Unmarshal(data, &session) != nil || session.RelyingPartyID != p.rpID ||
		session.Origin != p.origin || session.UserVerification != protocol.VerificationRequired || session.Mediation != protocol.MediationDefault {
		return session, ErrUnavailable
	}
	return session, nil
}

func (p *Passkeys) verifyRegistration(user passkeyUser, session webauthn.SessionData, response *protocol.CredentialCreationResponse) (*webauthn.Credential, error) {
	if response == nil || len(response.RawID) > 1023 ||
		base64.RawURLEncoding.EncodeToString(response.RawID) != response.ID {
		return nil, ErrPasskeyInvalidRegistration
	}
	parsed, err := response.Parse()
	if err != nil || parsed.Response.CollectedClientData.Origin != p.origin {
		return nil, ErrPasskeyInvalidRegistration
	}
	cred, err := p.webauthn.CreateCredential(user, session, parsed)
	if err != nil {
		return nil, ErrPasskeyInvalidRegistration
	}
	// None attestation still requires a usable COSE key, not only an offered algorithm.
	// 无证明模式也要求可用的 COSE 密钥，而非仅匹配所选算法。
	if _, err := webauthncose.ParsePublicKey(cred.PublicKey); err != nil {
		return nil, ErrPasskeyInvalidRegistration
	}
	return cred, nil
}

func (p *Passkeys) storeCredential(ctx context.Context, tx pgx.Tx, userID string, cred *webauthn.Credential) (PasskeySummary, error) {
	item, err := scanPasskeySummary(tx.QueryRow(ctx, `INSERT INTO passkey_credentials
		(user_id, rp_id, credential_id, public_key, sign_count, backup_eligible, backup_state, uv_initialized)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (rp_id, credential_id) DO NOTHING
		RETURNING id::text, label, created_at, last_used_at, backup_eligible, backup_state`,
		userID, p.rpID, cred.ID, cred.PublicKey, int64(cred.Authenticator.SignCount),
		cred.Flags.BackupEligible, cred.Flags.BackupState, cred.Flags.UserVerified))
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrPasskeyDuplicate
	}
	if err != nil {
		return item, ErrUnavailable
	}
	return item, nil
}
