export const RATE_LIMIT_BACKOFF_MS = 60_000;
export const ERROR_BACKOFF_MS = 30_000;

/**
 * Shared stale-cache / backoff / single-flight state machine for upstream card resolvers.
 *
 * Providers supply their fetch function plus the policy knobs that legitimately differ; the
 * ordering of the checks (backoff window, in-flight dedup, freshness, manual gate) and the
 * failure bookkeeping live here so they cannot drift between providers.
 *
 * - key, provider, kind: card identity used for the entry and for blank failure entries.
 * - existing: the cached entry or null. forceRefresh: the caller's manual refresh flag.
 * - pending: Map shared across calls for in-flight deduplication. now(): clock.
 * - envelope(entry, extra): public payload for an entry.
 * - createError(status, message) / toSafeError(error): the resolver's error type.
 * - store(entry): persists an entry (memory or disk).
 * - fetchFresh({ existing, attemptAt, lastManualAttemptAt }): returns the new entry; may return the
 *   mutated `existing` entry when upstream reports no change.
 * - manualIntervalMs: minimum spacing between manual refreshes of one entry.
 * - automaticIntervalMs: minimum spacing between automatic upstream attempts; null disables the gate.
 * - freshUntil(entry): when an entry stops being fresh; defaults to fetchedAt + refreshAfterMs.
 * - shouldCacheFailure(error): whether a failure records a backoff window (negative cache).
 * - unavailableMessage: fallback warning for a stored backoff entry without a message.
 */
export async function resolveCached({
    key,
    provider,
    kind,
    existing,
    forceRefresh,
    pending,
    now,
    envelope,
    createError,
    toSafeError,
    store,
    fetchFresh,
    manualIntervalMs,
    automaticIntervalMs = null,
    freshUntil = entry => entry.fetchedAt + entry.refreshAfterMs,
    shouldCacheFailure = () => true,
    unavailableMessage
}) {
    const startedAt = now();
    if (existing?.backoffUntil > startedAt) {
        if (existing.data) return envelope(existing, { stale: true, warning: existing.backoffMessage ?? unavailableMessage });
        throw createError(existing.backoffStatus ?? 502, existing.backoffMessage ?? unavailableMessage);
    }
    if (pending.has(key)) return pending.get(key);

    if (existing && !forceRefresh) {
        const fresh = freshUntil(existing) > startedAt;
        const automaticTooSoon = automaticIntervalMs !== null && startedAt - (existing.lastAttemptAt ?? 0) < automaticIntervalMs;
        if (fresh || automaticTooSoon) return envelope(existing);
    }
    if (forceRefresh && existing && Number.isFinite(existing.lastManualAttemptAt)) {
        const deferredMs = Math.max(0, manualIntervalMs - (startedAt - existing.lastManualAttemptAt));
        if (deferredMs) return envelope(existing, { refreshDeferredMs: deferredMs });
    }

    const work = (async () => {
        const attemptAt = now();
        const lastManualAttemptAt = forceRefresh ? attemptAt : existing?.lastManualAttemptAt;
        try {
            const entry = await fetchFresh({ existing, attemptAt, lastManualAttemptAt });
            entry.lastAttemptAt = attemptAt;
            entry.lastManualAttemptAt = lastManualAttemptAt;
            store(entry);
            return envelope(entry);
        } catch (error) {
            const safe = toSafeError(error);
            if (!shouldCacheFailure(safe)) throw safe;
            const entry = existing ?? { key, provider, kind, data: null, fetchedAt: 0, refreshAfterMs: 0 };
            entry.lastAttemptAt = attemptAt;
            entry.lastManualAttemptAt = lastManualAttemptAt;
            entry.backoffUntil = now() + (safe.status === 429 ? RATE_LIMIT_BACKOFF_MS : ERROR_BACKOFF_MS);
            entry.backoffStatus = safe.status;
            entry.backoffMessage = safe.message;
            store(entry);
            if (entry.data) return envelope(entry, { stale: true, warning: safe.message });
            throw safe;
        } finally {
            if (pending.get(key) === work) pending.delete(key);
        }
    })();
    pending.set(key, work);
    return work;
}
