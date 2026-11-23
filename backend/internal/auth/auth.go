package auth

import "errors"

var (
	ErrInvalidRequest     = errors.New("invalid_request")
	ErrUnavailable        = errors.New("service_unavailable")
	ErrOperationAbandoned = errors.New("operation_abandoned")
	ErrPasskeyNotFound    = errors.New("credential_not_found")
)

type Identity struct {
	UserID      string
	LoginName   string
	DisplayName string
}
