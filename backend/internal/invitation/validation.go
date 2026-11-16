package invitation

import (
	"errors"
	"net/mail"
	"strings"
	"unicode"
	"unicode/utf8"
)

var ErrInvalidInput = errors.New("invalid invitation input")

// NormalizeEmail validates and normalizes an email address used as an account identifier.
// NormalizeEmail 校验并规范化用作账户标识的邮箱地址。
func NormalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) < 3 || len(value) > 254 {
		return "", ErrInvalidInput
	}
	for _, c := range value {
		if c < 33 || c > 126 {
			return "", ErrInvalidInput
		}
	}
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || address.Name != "" || strings.Count(value, "@") != 1 {
		return "", ErrInvalidInput
	}
	return value, nil
}

// NormalizeLogin validates and normalizes a stable terminal login name.
// NormalizeLogin 校验并规范化稳定的终端登录名。
func NormalizeLogin(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) == 0 || len(value) > 128 {
		return "", ErrInvalidInput
	}
	for i, c := range value {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (i > 0 && (c == '-' || c == '_')) {
			continue
		}
		return "", ErrInvalidInput
	}
	switch value {
	case "guest", "anonymous", "admin", "administrator", "root", "system", "support", "null":
		return "", ErrInvalidInput
	}
	return value, nil
}

func normalizeDisplayName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) == 0 || utf8.RuneCountInString(value) > 128 {
		return "", ErrInvalidInput
	}
	for _, c := range value {
		if unicode.IsControl(c) || unicode.In(c, unicode.Cf) {
			return "", ErrInvalidInput
		}
	}
	return value, nil
}
