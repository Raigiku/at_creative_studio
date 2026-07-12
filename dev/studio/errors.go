package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/OpenRouterTeam/go-sdk/models/sdkerrors"
)

// ----- generation error envelope -----
//
// Every failure path from handleGenerate / generateImage / generateVideo
// funnels through writeGenError, which produces the same JSON shape the
// UI knows how to render. The shape is:
//
//	{
//	  "error": "...",        // human-readable, single line, safe to show
//	  "code":  "...",        // machine-readable category (see errorCode values)
//	  "retryable": false,    // hint to the UI: a "Retry" button makes sense?
//	  "unsupportedFields": []  // present only when code == "unsupported_fields"
//	}
//
// We also log the *original* error (with request id, body, etc.) to stderr
// so failures are visible in the launcher terminal even when the UI hides
// them.
const (
	errCodeAuth        = "auth"               // 401, 403 — bad or missing API key
	errCodeQuota       = "quota"              // 402 — out of credits
	errCodeRateLimit   = "rate_limit"         // 429 — slow down
	errCodeUnsupported = "unsupported_fields" // 400 — model rejected one or more params
	errCodeBadRequest  = "bad_request"        // 400 — anything else (bad prompt, etc.)
	errCodeModeration  = "moderation"         // 403 with moderation wording
	errCodeUpstream    = "upstream"           // 5xx, provider overloaded
	errCodeNetwork     = "network"            // dial errors, DNS, connection reset
	errCodeVideoFailed = "video_failed"       // async job ended in failed/cancelled/expired
	errCodeInternal    = "internal"           // anything we couldn't classify
)

// genError is the JSON envelope every generation failure is
// serialised into. The UI renders the `error` string in the
// status bar and (if present) pretty-prints `raw` under a
// collapsible disclosure.
type genError struct {
	Message           string          `json:"error"`
	Code              string          `json:"code"`
	Retryable         bool            `json:"retryable"`
	UnsupportedFields []string        `json:"unsupportedFields,omitempty"`
	// Raw is the upstream response body for SDK-classified
	// failures. It's a json.RawMessage so the client can pretty-
	// print it without re-parsing; "" when there's no upstream
	// body to forward (e.g. our own validation, network errors,
	// context cancellation). The UI hides the disclosure when
	// this is empty.
	Raw json.RawMessage `json:"raw,omitempty"`
}

// writeGenError logs the original error to stderr (so the launcher
// terminal still has the full SDK message) and returns a structured JSON
// body to the client.
func writeGenError(w http.ResponseWriter, genType, modelID string, status int, ge genError, orig error) {
	// Always log the original error in full. This is the only place where
	// the SDK's request id / response body survives — the client only gets
	// the short `Message`.
	if orig != nil {
		fmt.Fprintf(os.Stderr, "generate %s model=%s [%s/%d]: %v\n", genType, modelID, ge.Code, status, orig)
	} else {
		fmt.Fprintf(os.Stderr, "generate %s model=%s [%s/%d]: %s\n", genType, modelID, ge.Code, status, ge.Message)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ge)
}

// classifySDKError maps any error from the OpenRouter SDK into our genError
// envelope. The classification uses:
//
//  1. Typed SDK errors (e.g. *sdkerrors.UnauthorizedResponseError) when
//     the Go SDK actually returns them — these carry a parsed body with
//     a useful message.
//  2. The error message itself for "unsupported_fields": the SDK's
//     *sdkerrors.BadRequestResponseError wraps a body that usually names
//     the offending field. We pattern-match a few common phrasings.
//  3. Generic HTTP status codes as a fallback.
//
// Special-casses: context.DeadlineExceeded / context.Canceled become
// "upstream" (the SDK took too long — usually the model's fault).
func classifySDKError(err error) (int, genError) {
	if err == nil {
		return http.StatusInternalServerError, genError{
			Message: "unknown error", Code: errCodeInternal,
		}
	}

	// Context errors first — they have no HTTP status, but the user
	// experience is the same as an upstream timeout.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return http.StatusGatewayTimeout, genError{
			Message:   "the model took too long to respond. Try again or pick a smaller resolution.",
			Code:      errCodeUpstream,
			Retryable: true,
		}
	}

	// Typed SDK errors. Each one has a parsed body in `Error_` with a
	// `Message` and sometimes a numeric `Code`. Go's type switch binds
	// the case variable to the static type `error` when the switch has
	// a default, so we re-assert per case. We re-marshal the original
	// SDK struct into the `raw` field of the genError so the UI can
	// pretty-print the exact JSON OpenRouter sent back.
	switch e := err.(type) {
	case *sdkerrors.UnauthorizedResponseError:
		return http.StatusUnauthorized, genError{
			Message: friendlyAuthMessage(e.Error_.GetMessage()),
			Code:    errCodeAuth,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.ForbiddenResponseError:
		msg := e.Error_.GetMessage()
		if isModerationMessage(msg) {
			return http.StatusForbidden, genError{
				Message: "the request was blocked by the provider's content filter. Try rewording the prompt or removing the reference image.",
				Code:    errCodeModeration,
				Raw:     rawSDKErrorEnvelope(e),
			}
		}
		return http.StatusForbidden, genError{
			Message: friendlyAuthMessage(msg),
			Code:    errCodeAuth,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.PaymentRequiredResponseError:
		return http.StatusPaymentRequired, genError{
			Message: "your OpenRouter account is out of credits. Top up at openrouter.ai and try again.",
			Code:    errCodeQuota,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.TooManyRequestsResponseError:
		return http.StatusTooManyRequests, genError{
			Message:   "rate limit reached. Wait a few seconds and try again.",
			Code:      errCodeRateLimit,
			Retryable: true,
			Raw:       rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.ProviderOverloadedResponseError,
		*sdkerrors.ServiceUnavailableResponseError,
		*sdkerrors.BadGatewayResponseError,
		*sdkerrors.EdgeNetworkTimeoutResponseError,
		*sdkerrors.RequestTimeoutResponseError:
		return http.StatusBadGateway, genError{
			Message:   "the model provider is temporarily unavailable. Please retry in a moment.",
			Code:      errCodeUpstream,
			Retryable: true,
			Raw:       rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.UnprocessableEntityResponseError:
		return http.StatusBadRequest, genError{
			Message: friendlyBadRequestMessage(e.Error_.GetMessage()),
			Code:    errCodeBadRequest,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.BadRequestResponseError:
		msg := e.Error_.GetMessage()
		if fields := extractUnsupportedFields(msg); len(fields) > 0 {
			return http.StatusBadRequest, genError{
				Message:           "this model doesn't support some of the settings you picked: " + strings.Join(fields, ", ") + ". Remove them and try again.",
				Code:              errCodeUnsupported,
				Retryable:         true,
				UnsupportedFields: fields,
				Raw:               rawSDKErrorEnvelope(e),
			}
		}
		return http.StatusBadRequest, genError{
			Message: friendlyBadRequestMessage(msg),
			Code:    errCodeBadRequest,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.NotFoundResponseError, *sdkerrors.ConflictResponseError,
		*sdkerrors.PayloadTooLargeResponseError:
		return http.StatusBadRequest, genError{
			Message: friendlyBadRequestMessage(extractMessage(err.Error())),
			Code:    errCodeBadRequest,
			Raw:     rawSDKErrorEnvelope(e),
		}
	case *sdkerrors.APIError:
		return apiErrorByStatus(e)
	}

	// Non-SDK error. Most often a network failure (DNS, dial, TLS). The
	// Go http package's errors have a recognizable shape.
	msg := err.Error()
	if isNetworkError(msg) {
		return http.StatusBadGateway, genError{
			Message:   "couldn't reach OpenRouter (" + msg + "). Check your internet connection and try again.",
			Code:      errCodeNetwork,
			Retryable: true,
		}
	}

	// Last resort: 500, opaque. The original err is logged by writeGenError
	// so it's not lost.
	return http.StatusInternalServerError, genError{
		Message: "generation failed: " + msg,
		Code:    errCodeInternal,
	}
}

// apiErrorByStatus maps the generic *sdkerrors.APIError to a category
// based on its HTTP status code. The SDK stashes the raw response body
// in `e.Body`; we forward it (when it parses as JSON) so the UI can
// show the exact upstream payload.
func apiErrorByStatus(e *sdkerrors.APIError) (int, genError) {
	raw := rawFromAPIErrorBody(e.Body)
	switch {
	case e.StatusCode == 401:
		return http.StatusUnauthorized, genError{
			Message: friendlyAuthMessage(extractMessage(e.Body)),
			Code:    errCodeAuth,
			Raw:     raw,
		}
	case e.StatusCode == 402:
		return http.StatusPaymentRequired, genError{
			Message: "your OpenRouter account is out of credits. Top up at openrouter.ai and try again.",
			Code:    errCodeQuota,
			Raw:     raw,
		}
	case e.StatusCode == 403:
		msg := extractMessage(e.Body)
		if isModerationMessage(msg) {
			return http.StatusForbidden, genError{
				Message: "the request was blocked by the provider's content filter. Try rewording the prompt or removing the reference image.",
				Code:    errCodeModeration,
				Raw:     raw,
			}
		}
		return http.StatusForbidden, genError{
			Message: friendlyAuthMessage(msg), Code: errCodeAuth, Raw: raw,
		}
	case e.StatusCode == 408, e.StatusCode == 504:
		return http.StatusGatewayTimeout, genError{
			Message:   "the model took too long to respond. Try again or pick a smaller resolution.",
			Code:      errCodeUpstream,
			Retryable: true,
			Raw:       raw,
		}
	case e.StatusCode == 413:
		return http.StatusRequestEntityTooLarge, genError{
			Message: "the request was too large. Try fewer or smaller reference images.",
			Code:    errCodeBadRequest,
			Raw:     raw,
		}
	case e.StatusCode == 429:
		return http.StatusTooManyRequests, genError{
			Message:   "rate limit reached. Wait a few seconds and try again.",
			Code:      errCodeRateLimit,
			Retryable: true,
			Raw:       raw,
		}
	case e.StatusCode >= 500 && e.StatusCode < 600:
		return http.StatusBadGateway, genError{
			Message:   "the model provider is temporarily unavailable. Please retry in a moment.",
			Code:      errCodeUpstream,
			Retryable: true,
			Raw:       raw,
		}
	case e.StatusCode == 400:
		body := extractMessage(e.Body)
		if fields := extractUnsupportedFields(body); len(fields) > 0 {
			return http.StatusBadRequest, genError{
				Message:           "this model doesn't support some of the settings you picked: " + strings.Join(fields, ", ") + ". Remove them and try again.",
				Code:              errCodeUnsupported,
				Retryable:         true,
				UnsupportedFields: fields,
				Raw:               raw,
			}
		}
		return http.StatusBadRequest, genError{
			Message: friendlyBadRequestMessage(body),
			Code:    errCodeBadRequest,
			Raw:     raw,
		}
	default:
		return http.StatusBadGateway, genError{
			Message: "upstream error (HTTP " + strconv.Itoa(e.StatusCode) + "): " + e.Message,
			Code:    errCodeUpstream,
			Raw:     raw,
		}
	}
}

// extractUnsupportedFields scans a 400 error body for the names of
// params the model rejected. OpenRouter's messages tend to mention the
// field verbatim ("unsupported parameter: quality", "size is not
// supported", "invalid value for aspect_ratio", etc.). We return the
// canonical studio form names that match the <input name="..."> in the
// HTML form so the UI can disable the right controls.
func extractUnsupportedFields(body string) []string {
	if body == "" {
		return nil
	}
	low := strings.ToLower(body)

	// Map: keyword(s) that suggest this field is the offender → studio form
	// field name. Order matters: longer / more specific patterns first.
	candidates := []struct {
		match []string
		field string
	}{
		{[]string{"input_references", "reference image", "ref image", "i2v"}, "ref"},
		{[]string{"frame_first", "first frame", "first_frame"}, "frame_first"},
		{[]string{"frame_last", "last frame", "last_frame"}, "frame_last"},
		{[]string{"aspect_ratio", "aspect ratio", "ratio"}, "aspect_ratio"},
		{[]string{"resolution", "size not supported", "1080p", "4k"}, "resolution"},
		{[]string{"size", "width", "height"}, "size"},
		{[]string{"duration", "seconds", "second long"}, "duration"},
		{[]string{"generate_audio", "audio"}, "generate_audio"},
		{[]string{"background", "transparent"}, "background"},
		{[]string{"output_format", "output format", "media type"}, "output_format"},
		{[]string{"quality"}, "quality"},
		{[]string{"output_compression", "compression"}, "output_compression"},
		{[]string{"seed"}, "seed"},
		{[]string{"n", "number of images", "num_images"}, "n"},
	}

	seen := map[string]bool{}
	var out []string
	for _, c := range candidates {
		if seen[c.field] {
			continue
		}
		for _, m := range c.match {
			if strings.Contains(low, m) {
				seen[c.field] = true
				out = append(out, c.field)
				break
			}
		}
	}
	return out
}

// isModerationMessage returns true if the body looks like a content
// moderation rejection rather than an auth failure.
func isModerationMessage(body string) bool {
	low := strings.ToLower(body)
	return strings.Contains(low, "moderation") ||
		strings.Contains(low, "content policy") ||
		strings.Contains(low, "content filter") ||
		strings.Contains(low, "safety") ||
		strings.Contains(low, "refused to") ||
		strings.Contains(low, "inappropriate")
}

// isNetworkError matches the typical strings net/http / x/net errors emit.
func isNetworkError(msg string) bool {
	low := strings.ToLower(msg)
	return strings.Contains(low, "no such host") ||
		strings.Contains(low, "connection refused") ||
		strings.Contains(low, "connection reset") ||
		strings.Contains(low, "timeout") ||
		strings.Contains(low, "tls handshake") ||
		strings.Contains(low, "network is unreachable") ||
		strings.Contains(low, "eof") ||
		strings.HasPrefix(low, "dial ")
}

// extractMessage pulls a JSON-shaped `message` field from a raw response
// body, falling back to the whole body if it isn't JSON. The OpenRouter
// error bodies are always JSON, but defensive parsing here means a stray
// HTML error page (e.g. from a proxy) still surfaces something readable.
func extractMessage(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	var m struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(body), &m); err == nil {
		if msg := strings.TrimSpace(m.Error.Message); msg != "" {
			return msg
		}
		if msg := strings.TrimSpace(m.Message); msg != "" {
			return msg
		}
	}
	return body
}

// rawSDKErrorEnvelope re-marshals a typed SDK error to the same JSON
// shape OpenRouter sent us. The OpenRouter SDK parses the response body
// into typed Go structs, so to get the original JSON back we wrap the
// parsed `Error_` plus the envelope fields (`user_id`,
// `openrouter_metadata`) the SDK exposes. Returns nil if anything goes
// wrong — the caller treats that as "no raw body to forward".
func rawSDKErrorEnvelope(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

// rawFromAPIErrorBody returns the upstream response body if it's valid
// JSON. The body is a string the SDK stashed for the *sdkerrors.APIError
// fallback path; we hand it back to the client as-is when it parses.
// Returns nil on parse failure or empty body.
func rawFromAPIErrorBody(body string) json.RawMessage {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	if !json.Valid([]byte(body)) {
		return nil
	}
	// Re-marshal to compact it (the SDK may have preserved
	// whitespace, and we want a single canonical line for the
	// pretty-print to break on).
	var v any
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

// friendlyAuthMessage turns a raw "No cookie auth credentials found" or
// similar auth error into something a non-developer can act on.
func friendlyAuthMessage(raw string) string {
	if raw == "" {
		return "your API key is invalid or expired. Update it with scripts\\set-key.bat."
	}
	return "your API key is invalid or expired. (" + raw + ") Update it with scripts\\set-key.bat."
}

// friendlyBadRequestMessage keeps the upstream message (which is usually
// specific and useful) but prefixes a hint so the user knows it's about
// the request, not the server.
func friendlyBadRequestMessage(raw string) string {
	if raw == "" {
		return "OpenRouter rejected the request. Check your prompt, model, and parameters."
	}
	return "OpenRouter rejected the request: " + raw
}
