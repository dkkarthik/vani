# Actionable deep-refresh conflicts

A bare HTTP conflict does not identify the failed prerequisite. Preserve API error
messages from both VANI's nested envelope and Fastify's top-level envelope. When a
409 has no useful message, explain that refresh was not started, direct users to
review public queries, and request the API log if configuration is already valid.
Do not treat every conflict as a missing-query failure or automatically expose
uploaded manuscript text to online search.

Make missing-input errors name the existing UI controls: Research focus and
related work → Edit focus and anchors → Public search queries. Keep the explicit
public-query requirement and the 409 status. Verify nested/top-level error parsing,
generic and non-JSON failures, and propagation through the deep-refresh endpoint.
The desktop's exact failure remains unconfirmed until its API log is available.

## Reproduced cause

Fastify routes captured the default error handler because buildApp installed the
VANI handler after registering routes. Register the handler first so errors use
the expected nested envelope. A regression test reproduces the old 409 envelope
and verifies the actual deep-refresh endpoint preserves the diagnostic message.
The client additionally handles default/older Fastify envelopes for compatibility.
