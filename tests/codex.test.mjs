import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBridge } from "../bridge/server.mjs";
import { validateCodex } from "../vencord/discordRichCards/validation.ts";

test("Codex status uses a fixed public endpoint, normalizes inactive data, and preserves cache/backoff", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richcards-codex-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = 1_800_000_000_000;
    let calls = 0;
    let status = 200;
    const bridge = createBridge({ env: {}, port: 0, dataFile: path.join(dir, "state.json"), now: () => now,
        fetch: async (url, options) => {
            calls++;
            assert.equal(url, "https://hascodexratelimitreset.today/api/status");
            assert.equal(options.redirect, "error");
            assert.equal(options.headers.authorization, undefined);
            assert.ok(options.signal instanceof AbortSignal);
            return Response.json({ state: "no", resetAt: null, automationSummary: {
                mode: "inactive", checkedAt: now - 86_400_000,
                tweetText: "A tracked post", tweetUrl: "https://evil.example/post", rationale: "No reset announced",
                lastError: "Do not expose upstream diagnostic details"
            } }, { status });
        }
    });
    await bridge.listen();
    t.after(() => bridge.close());
    const url = `http://127.0.0.1:${bridge.port}/api/cards/codex/reset/today`;
    const get = async (suffix = "") => (await fetch(url + suffix)).json();
    const first = await get();
    assert.equal(validateCodex(first.data), true);
    assert.equal(validateCodex({ ...first.data, tweetUrl: "javascript:alert(1)" }), false);
    assert.equal(validateCodex({ ...first.data, checkedAt: "invalid" }), false);
    assert.equal(first.data.state, "no");
    assert.equal(first.data.monitor, "inactive");
    assert.equal(first.data.checkedAt, new Date(now - 86_400_000).toISOString());
    assert.equal(first.data.tweetUrl, null);
    assert.equal(first.data.resetAt, null);
    assert.equal(first.data.lastError, undefined);
    await get();
    assert.equal(calls, 1);
    now += 1000;
    await get("?refresh=1");
    assert.equal(calls, 2);
    assert.equal((await get("?refresh=1")).refreshDeferredMs, 5000);
    assert.equal(calls, 2);
    now += 5000;
    status = 429;
    const stale = await get("?refresh=1");
    assert.equal(stale.stale, true);
    assert.equal(stale.data.state, "no");
    await get("?refresh=1");
    assert.equal(calls, 3);
    now += 60_000;
    status = 200;
    assert.notEqual((await get()).stale, true);
    assert.equal(calls, 4);
    assert.equal((await fetch(url.replace("today", "other"))).status, 400);
});

test("Codex status retains explicit yes/unknown values and rejects malformed upstream data", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richcards-codex-schema-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = 1_800_000_000_000;
    let payload = { state: "yes", resetAt: now, automationSummary: { mode: "active", latest: {
        checkedAt: now, tweetText: "Limits reset", tweetUrl: "https://x.com/thsottiaux/status/123", rationale: "Reset announced"
    } } };
    const bridge = createBridge({ env: {}, port: 0, dataFile: path.join(dir, "state.json"), now: () => now,
        fetch: async () => Response.json(payload) });
    await bridge.listen();
    t.after(() => bridge.close());
    const url = `http://127.0.0.1:${bridge.port}/api/cards/codex/reset/today`;
    const get = async () => (await fetch(url)).json();
    const yes = await get();
    assert.equal(validateCodex(yes.data), true);
    assert.equal(yes.data.state, "yes");
    assert.equal(yes.data.resetAt, new Date(now).toISOString());
    assert.equal(yes.data.tweetUrl, "https://x.com/thsottiaux/status/123");
    now += 31_000;
    payload = { state: "undecided" };
    assert.deepEqual((await get()).data, { state: "unknown", monitor: "unknown", checkedAt: null, resetAt: null,
        tweetText: "", tweetUrl: null, rationale: "" });
    now += 31_000;
    payload = {};
    const invalid = await get();
    assert.equal(invalid.stale, true);
    assert.match(invalid.warning, /invalid response/);
});
