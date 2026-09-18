import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { createBridge } = await import("../bridge/server.mjs");

function tempDataFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richcards-bridge-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, "state.json");
}

async function running(t, options = {}) {
    const bridge = createBridge({ host: "127.0.0.1", port: 0, ...options });
    await bridge.listen();
    t.after(() => bridge.close());
    return `http://127.0.0.1:${bridge.port}`;
}

function request(base, route, options = {}) {
    return fetch(`${base}${route}`, options);
}

function githubResponse(status, body, headers = {}) {
    return new Response(body == null ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers }
    });
}

const pull = {
    number: 1,
    title: "Improve cache",
    state: "open",
    draft: false,
    user: { login: "octocat" },
    base: { ref: "main" },
    head: { ref: "feature/cache" },
    labels: [{ name: "performance" }],
    changed_files: 3,
    additions: 16,
    deletions: 4,
    comments: 2,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    html_url: "https://github.com/acme/widgets/pull/1"
};

test("legacy Hermes sessions and actions remain authenticated and persist", async t => {
    const dataFile = tempDataFile(t);
    const base = await running(t, { dataFile, token: "bridge-token" });

    assert.equal((await request(base, "/api/sessions/demo")).status, 401);
    const headers = { authorization: "Bearer bridge-token", "content-type": "application/json" };
    const put = await request(base, "/api/sessions/demo", {
        method: "PUT", headers, body: JSON.stringify({ title: "Demo", status: "running" })
    });
    assert.equal(put.status, 200);
    const action = await request(base, "/api/sessions/demo/actions", {
        method: "POST", headers, body: JSON.stringify({ action: "pause" })
    });
    assert.equal(action.status, 202);

    const restart = await running(t, { dataFile, token: "bridge-token" });
    const session = await (await request(restart, "/api/sessions/demo", { headers })).json();
    const actions = await (await request(restart, "/api/sessions/demo/actions", { headers })).json();
    const card = await (await request(restart, "/api/cards/hermes/session/demo", { headers })).json();
    assert.equal(session.title, "Demo");
    assert.equal(actions[0].action, "pause");
    assert.equal(card.data.sessionId, "demo");
    assert.equal(card.refreshAfterMs, 1_000);
});

test("legacy marker-compatible IDs remain valid", async t => {
    const base = await running(t, { dataFile: tempDataFile(t) });
    const sessionId = ".worker:queue_1-2";
    const response = await request(base, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Accepted ID" })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessionId, sessionId);
});

test("bridge fails closed for corrupt persistence and browser-origin requests", async t => {
    const corruptFile = tempDataFile(t);
    fs.writeFileSync(corruptFile, "not json");
    assert.throws(() => createBridge({ dataFile: corruptFile }), /Unable to load bridge data/);
    const invalidSchemaFile = tempDataFile(t);
    fs.writeFileSync(invalidSchemaFile, "[]");
    assert.throws(() => createBridge({ dataFile: invalidSchemaFile }), /Unable to load bridge data/);
    assert.throws(() => createBridge({ dataFile: tempDataFile(t), githubToken: "private-token" }), /RICHCARDS_TOKEN/);
    assert.throws(() => createBridge({ dataFile: tempDataFile(t), host: "0.0.0.0" }), /RICHCARDS_TOKEN/);

    const base = await running(t, { dataFile: tempDataFile(t) });
    const response = await request(base, "/health", { headers: { origin: "https://untrusted.example" } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.has("access-control-allow-origin"), false);
    assert.equal((await request(base, "/health", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("legacy and generic routes reject invalid input without prototype mutation", async t => {
    let githubCalls = 0;
    const base = await running(t, {
        dataFile: tempDataFile(t),
        fetch: async () => {
            githubCalls++;
            return githubResponse(200, pull);
        }
    });
    assert.equal((await request(base, "/api/sessions/%5F%5Fproto%5F%5F")).status, 400);
    assert.equal((await request(base, "/api/cards/github/pr/not-a-pull-request")).status, 400);
    assert.equal((await request(base, "/api/cards/github/pr/acme_name%2Fwidgets%231")).status, 400);
    assert.equal((await request(base, "/api/cards/github/pr/acme%2F.%231")).status, 400);
    assert.equal((await request(base, "/api/cards/github/pr/acme%2Fwidgets%239007199254740992")).status, 400);
    assert.equal((await request(base, "/api/cards/nope/pr/acme%2Fwidgets%231")).status, 404);
    assert.equal(githubCalls, 0);
});

test("GitHub cards normalize, cache, honor ETags, and survive restart", async t => {
    const dataFile = tempDataFile(t);
    let now = 1_000_000;
    const calls = [];
    const fakeFetch = async (url, options) => {
        calls.push({ url, ...options });
        return calls.length === 2 ? githubResponse(304, null, { etag: "v1" }) : githubResponse(200, pull, { etag: "v1" });
    };
    const headers = { authorization: "Bearer github-bridge" };
    const settings = { dataFile, token: "github-bridge", now: () => now, fetch: fakeFetch };
    const base = await running(t, settings);
    const cardPath = "/api/cards/github/pr/acme%2Fwidgets%231";
    const first = await (await request(base, cardPath, { headers })).json();
    assert.deepEqual(first.data, {
        owner: "acme", repo: "widgets", number: 1, title: "Improve cache", state: "open", draft: false,
        author: "octocat", base: "main", head: "feature/cache", labels: ["performance"], changedFiles: 3,
        additions: 16, deletions: 4, comments: 2, createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-02T00:00:00Z", url: "https://github.com/acme/widgets/pull/1"
    });
    assert.equal(first.version, 1);
    assert.equal(first.provider, "github");
    assert.equal(first.kind, "pr");
    assert.equal(first.refreshAfterMs, 30_000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "error");
    assert.ok(calls[0].signal instanceof AbortSignal);

    const manual = await (await request(base, `${cardPath}?refresh=1`, { headers })).json();
    assert.equal(manual.data.title, "Improve cache");
    assert.equal(calls.length, 2, "the first manual refresh fetches immediately");
    assert.equal(calls[1].headers["if-none-match"], "v1");
    const deferred = await (await request(base, `${cardPath}?refresh=1`, { headers })).json();
    assert.equal(deferred.refreshDeferredMs, 5_000, "a repeated manual refresh is deferred for five seconds");
    assert.equal(calls.length, 2);
    now += 5_000;
    const refreshed = await (await request(base, `${cardPath}?refresh=1`, { headers })).json();
    assert.equal(refreshed.data.title, "Improve cache");
    assert.equal(calls.length, 3);

    await Promise.all([
        request(base, "/api/cards/github/pr/acme%2Fwidgets%232", { headers }),
        request(base, "/api/cards/github/pr/acme%2Fwidgets%232", { headers })
    ]);
    assert.equal(calls.length, 4, "concurrent requests for one card share one GitHub request");

    const restart = await running(t, settings);
    await request(restart, cardPath, { headers });
    assert.equal(calls.length, 4, "fresh persisted cards do not refetch after a bridge restart");
});

test("an explicit refresh immediately after an automatic poll gets new GitHub state once", async t => {
    const dataFile = tempDataFile(t);
    let now = 1_000_000;
    let state = "open";
    let calls = 0;
    const headers = { authorization: "Bearer github-bridge" };
    const base = await running(t, {
        dataFile,
        token: "github-bridge",
        now: () => now,
        fetch: async () => {
            calls++;
            return githubResponse(200, { ...pull, state, merged_at: state === "merged" ? "2026-09-03T00:00:00Z" : null });
        }
    });
    const route = "/api/cards/github/pr/acme%2Fwidgets%231";

    assert.equal((await (await request(base, route, { headers })).json()).data.state, "open");
    now += 30_001;
    assert.equal((await (await request(base, route, { headers })).json()).data.state, "open", "the automatic poll refreshed the open card");

    state = "merged";
    const merged = await (await request(base, `${route}?refresh=1`, { headers })).json();
    assert.equal(merged.data.state, "merged", "the first explicit refresh bypasses the automatic poll gate");
    assert.equal(calls, 3);

    const deferred = await (await request(base, `${route}?refresh=1`, { headers })).json();
    assert.equal(deferred.data.state, "merged");
    assert.equal(deferred.refreshDeferredMs, 5_000);
    assert.equal(calls, 3, "repeat manual requests do not call GitHub again during the five second window");

    now += 5_000;
    await request(base, `${route}?refresh=1`, { headers });
    assert.equal(calls, 4, "an explicit retry fetches again when its deferral expires");
});

test("the plugin-owned bridge core serves standalone legacy routes", async t => {
    const { createBridge: createPluginBridge } = await import("../vencord/discordRichCards/bridge/runtime.mjs");
    const bridge = createPluginBridge({ host: "127.0.0.1", port: 0, dataFile: tempDataFile(t) });
    await bridge.listen();
    t.after(() => bridge.close());
    const base = `http://127.0.0.1:${bridge.port}`;
    const saved = await fetch(`${base}/api/sessions/demo`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Plugin-owned core" })
    });
    assert.equal(saved.status, 200);
    const card = await (await fetch(`${base}/api/cards/hermes/session/demo`)).json();
    assert.equal(card.data.title, "Plugin-owned core");
});

test("GitHub errors are safe and backed off", async t => {
    const dataFile = tempDataFile(t);
    let calls = 0;
    const base = await running(t, {
        dataFile,
        token: "github-bridge",
        fetch: async () => {
            calls++;
            return githubResponse(403, { message: "secret credential must not leak" }, { "x-ratelimit-remaining": "0" });
        }
    });
    const route = "/api/cards/github/pr/acme%2Fwidgets%231";
    const headers = { authorization: "Bearer github-bridge" };
    const first = await request(base, route, { headers });
    assert.equal(first.status, 429);
    assert.equal((await first.json()).error, "GitHub rate limit reached; try again later");
    const second = await request(base, route, { headers });
    assert.equal(second.status, 429);
    assert.equal(calls, 1);
});

test("cached GitHub cards remain available during a failed refresh and bridge restart", async t => {
    const dataFile = tempDataFile(t);
    let now = 1_000_000;
    let fail = false;
    let calls = 0;
    const headers = { authorization: "Bearer github-bridge" };
    const settings = {
        dataFile,
        token: "github-bridge",
        now: () => now,
        fetch: async () => {
            calls++;
            return fail ? githubResponse(500, { message: "upstream details must stay private" }) : githubResponse(200, pull);
        }
    };
    const route = "/api/cards/github/pr/acme%2Fwidgets%231";
    const base = await running(t, settings);
    assert.equal((await request(base, route, { headers })).status, 200);
    now += 15_001;
    fail = true;
    const stale = await (await request(base, `${route}?refresh=1`, { headers })).json();
    assert.equal(stale.stale, true);
    assert.equal(stale.warning, "GitHub could not provide this pull request");
    assert.equal(stale.data.title, "Improve cache");

    const restart = await running(t, settings);
    const afterRestart = await (await request(restart, route, { headers })).json();
    assert.equal(afterRestart.stale, true);
    assert.equal(calls, 2);
});
