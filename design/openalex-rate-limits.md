# Resume discovery after OpenAlex rate limits

HTTP 429 is a source quota/rate limit, not evidence of invalid collection queries.
Preserve the failed task and cursor without consuming generic task retries. Persist
a shared OpenAlex cooldown for core discovery, and a next-attempt timestamp on the
run. Other runs and local work remain eligible while the throttled run waits.
Honor Retry-After seconds/dates and, for exhausted daily budgets, the documented
X-RateLimit-Reset seconds-until-reset header. Without headers use exponential
30-second to one-hour backoff; exhausted daily budgets without a reset header wait
until midnight UTC. Show the retry time and retain cooldown across restart/manual
refresh. Success clears the rate-limit failure count. Other connector paths are
outside this change. Existing historical discarded tasks are not reconstructed.

Reference: https://help.openalex.org/api/authentication/ and /api/errors/.
Verify header handling and real worker persistence/no premature retry in PostgreSQL.
