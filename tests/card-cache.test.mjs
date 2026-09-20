import assert from "node:assert/strict";
import test from "node:test";

const { resolveCached, ERROR_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS } = await import("../vencord/discordRichCards/bridge/cardCache.mjs");

class TestError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function harness({ now, fetchFresh, ...overrides } = {}) {
    const store = new Map();
    const pending = new Map();
    const calls = [];
    const resolve = (forceRefresh = false, extra = {}) => resolveCached({
        key: "test:card:1",
        provider: "test",
        kind: "card",
        existing: store.get("test:card:1") ?? null,
        forceRefresh,
        pending,
        now,
        envelope: (entry, more = {}) => ({ data: entry.data, ...more }),
        createError: (status, message) => new TestError(status, message),
        toSafeError: error => error instanceof TestError ? error : new TestError(502, "unavailable"),
        store: entry => store.set(entry.key, entry),
        fetchFresh: async context => {
            calls.push(context);
            return fetchFresh(context);
        },
        manualIntervalMs: 5_000,
        ...overrides,
        ...extra
    });
    return { resolve, store, pending, calls };
}

test("single-flight: concurrent callers share one upstream request and the pending slot is released", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { resolve, pending, calls } = harness({
        now: () => 1_000_000,
        fetchFresh: async () => { await gate; return { key: "test:card:1", data: 1, fetchedAt: 1_000_000, refreshAfterMs: 30_000 }; }
    });
    const [first, second] = [resolve(), resolve()];
    assert.equal(pending.size, 1);
    release();
    assert.deepEqual(await Promise.all([first, second]), [{ data: 1 }, { data: 1 }]);
    assert.equal(calls.length, 1);
    assert.equal(pending.size, 0);
});

test("fresh entries and the automatic interval gate suppress upstream requests; manual refreshes are gated separately", async () => {
    let now = 1_000_000;
    let value = 0;
    const { resolve, calls } = harness({
        now: () => now,
        automaticIntervalMs: 15_000,
        fetchFresh: async () => ({ key: "test:card:1", data: ++value, fetchedAt: now, refreshAfterMs: 1_000 })
    });
    assert.deepEqual(await resolve(), { data: 1 });
    now += 2_000;
    assert.deepEqual(await resolve(), { data: 1 }, "stale but inside the automatic interval");
    assert.deepEqual(await resolve(true), { data: 2 }, "manual refresh bypasses the automatic gate");
    now += 1_000;
    assert.deepEqual(await resolve(true), { data: 2, refreshDeferredMs: 4_000 });
    now += 15_000;
    assert.deepEqual(await resolve(), { data: 3 });
    assert.equal(calls.length, 3);
});

test("without an automatic gate, a stale entry is refreshed immediately using freshUntil", async () => {
    let now = 1_000_000;
    let value = 0;
    const { resolve } = harness({
        now: () => now,
        freshUntil: entry => entry.expiresAt,
        fetchFresh: async () => ({ key: "test:card:1", data: ++value, fetchedAt: now, refreshAfterMs: 1_000, expiresAt: now + 1_000 })
    });
    assert.deepEqual(await resolve(), { data: 1 });
    now += 999;
    assert.deepEqual(await resolve(), { data: 1 });
    now += 1;
    assert.deepEqual(await resolve(), { data: 2 });
});

test("failures record a backoff window, serve stale data with a warning, and rethrow when nothing is cached", async () => {
    let now = 1_000_000;
    let fail = null;
    const { resolve, store } = harness({
        now: () => now,
        unavailableMessage: "fallback",
        fetchFresh: async () => {
            if (fail) throw fail;
            return { key: "test:card:1", data: "ok", fetchedAt: now, refreshAfterMs: 1_000 };
        }
    });
    fail = new TestError(429, "slow down");
    await assert.rejects(resolve(), { status: 429, message: "slow down" });
    assert.equal(store.get("test:card:1").backoffUntil, now + RATE_LIMIT_BACKOFF_MS);
    await assert.rejects(resolve(), { status: 429, message: "slow down" }, "backoff window rethrows without calling upstream");

    now += RATE_LIMIT_BACKOFF_MS;
    fail = null;
    assert.deepEqual(await resolve(), { data: "ok" });
    now += 1_000;
    fail = new Error("boom");
    assert.deepEqual(await resolve(true), { data: "ok", stale: true, warning: "unavailable" });
    assert.equal(store.get("test:card:1").backoffUntil, now + ERROR_BACKOFF_MS);
    assert.deepEqual(await resolve(true), { data: "ok", stale: true, warning: "unavailable" });
});

test("shouldCacheFailure opts a failure out of the negative cache", async () => {
    const { resolve, store, calls } = harness({
        now: () => 1_000_000,
        shouldCacheFailure: error => error.status !== 404,
        fetchFresh: async () => { throw new TestError(404, "missing"); }
    });
    await assert.rejects(resolve(), { status: 404 });
    await assert.rejects(resolve(), { status: 404 });
    assert.equal(store.size, 0);
    assert.equal(calls.length, 2);
});
