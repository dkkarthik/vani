export class SourceRateLimit extends Error {
  constructor(public retryAt: Date) {
    super(
      `OpenAlex rate limit reached. Discovery will retry automatically at ${retryAt.toISOString()}. Saved candidates and search progress are retained.`,
    );
  }
}
export function retryTime(
  headers: Headers,
  failures: number,
  now = Date.now(),
) {
  const fallback = Math.min(3600000, 30000 * 2 ** Math.min(failures, 7));
  const raw = headers.get("retry-after");
  const seconds = raw === null || !raw.trim() ? NaN : Number(raw);
  const retry =
    Number.isFinite(seconds) && seconds >= 0
      ? now + seconds * 1000
      : raw
        ? Date.parse(raw)
        : NaN;
  let reset = NaN;
  if (
    headers.get("x-ratelimit-remaining") !== null &&
    Number(headers.get("x-ratelimit-remaining")) === 0
  ) {
    const value = headers.get("x-ratelimit-reset");
    const delay = value === null || !value.trim() ? NaN : Number(value);
    reset =
      Number.isFinite(delay) && delay >= 0
        ? now + delay * 1000
        : Date.UTC(
            new Date(now).getUTCFullYear(),
            new Date(now).getUTCMonth(),
            new Date(now).getUTCDate() + 1,
          );
  }
  return new Date(
    Math.max(
      now + 1000,
      Number.isFinite(retry) ? retry : now + fallback,
      Number.isFinite(reset) ? reset : 0,
    ),
  );
}
