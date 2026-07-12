package main

// HTTP-client wrapper that records per-request timing and outcome.
//
// The OpenRouter SDK accepts a custom HTTP client via
// `openrouter.WithClient(...)`. We pass in a thin wrapper around
// `http.DefaultClient` whose only job is to log, to stderr:
//
//	[<timestamp>] [<label>] http: <METHOD> <path> -> <status> in <duration>
//
// or, on transport errors (DNS, dial, our own timeout):
//
//	[<timestamp>] [<label>] http: <METHOD> <path> -> error after <duration>: <err>
//
// Why: when a generation fails with a 504, the question is always
// "did the model take too long, or did the upstream provider fail?"
// The status code alone doesn't answer it — a 504 in 30 seconds is
// an upstream failure, a 504 after our 10-minute client timeout
// is our own deadline. Logging the duration pins it down.
//
// We do NOT log request or response headers. The Authorization
// header is the obvious reason (carries the API key), but the
// rule is broader: response headers can carry provider-specific
// metadata that we don't want in the terminal log. We log the
// status code and the path only.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

// openrouterHTTPClient is the minimal interface the SDK requires
// (mirrors hooks.HTTPClient, but kept as a local alias so this
// file doesn't need to import an internal SDK package).
type openrouterHTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// timingClient wraps an HTTPClient and logs each call's duration
// and outcome to stderr.
type timingClient struct {
	inner openrouterHTTPClient
	label string // e.g. "image", "video-submit", "video-poll"
}

// Do executes the request via the wrapped client, then logs the
// result. The response is returned unchanged so the SDK continues
// to handle retries and status-code mapping exactly as before.
func (c *timingClient) Do(req *http.Request) (*http.Response, error) {
	start := time.Now()
	resp, err := c.inner.Do(req)
	dur := time.Since(start)
	now := time.Now().Format("15:04:05.000")
	path := requestPath(req.URL)

	switch {
	case err != nil:
		// Transport-level failure. errors.Is(err, context.DeadlineExceeded)
		// is the signature of "our own timeout fired before any response
		// came back" — the most useful thing to surface distinctly,
		// because it means the model may have been about to finish.
		tag := "error"
		if errors.Is(err, context.DeadlineExceeded) {
			tag = "client-timeout"
		}
		fmt.Fprintf(os.Stderr, "[%s] [%s] http: %s %s -> %s after %s: %v\n",
			now, c.label, req.Method, path, tag, dur, err)
	case resp != nil:
		fmt.Fprintf(os.Stderr, "[%s] [%s] http: %s %s -> %d in %s\n",
			now, c.label, req.Method, path, resp.StatusCode, dur)
	}
	return resp, err
}

// requestPath returns just the path component of u, dropping query
// string and fragment. We log only the path — the query string can
// carry provider-injected identifiers we don't want in the log.
func requestPath(u *url.URL) string {
	if u == nil {
		return "<nil url>"
	}
	if u.Path == "" {
		return "/"
	}
	return u.Path
}
