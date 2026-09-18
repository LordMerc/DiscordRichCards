import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createBridge } from "../bridge/server.mjs";
import { validateHermes } from "../vencord/discordRichCards/validation.ts";

test("real Hermes demo publishes renderer-valid state and consumes pause/resume/cancel", { timeout: 15000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "richcards-demo-"));
    const bridge = createBridge({ host: "127.0.0.1", port: 0, token: "fixture", githubToken: "", dataFile: join(dir, "state.json") });
    await bridge.listen();
    const base = `http://127.0.0.1:${bridge.port}`;
    const child = spawn(process.execPath, [resolve("bridge/demo-publisher.mjs")], { env: { ...process.env, RICHCARDS_URL: base, RICHCARDS_TOKEN: "fixture", RICHCARDS_SESSION: "test:demo" }, stdio: "ignore" });
    async function waitState(status) {
        for (let i = 0; i < 60; i++) {
            const response = await fetch(`${base}/api/cards/hermes/session/test%3Ademo`, { headers: { authorization: "Bearer fixture" } });
            const result = await response.json();
            if (result.data?.status === status) { assert.equal(validateHermes(result.data), true); return; }
            await delay(100);
        }
        assert.fail(`Demo did not enter ${status}`);
    }
    try {
        await waitState("running");
        for (const [action, status] of [["pause", "paused"], ["resume", "running"], ["cancel", "cancelled"]]) {
            const response = await fetch(`${base}/api/sessions/test%3Ademo/actions`, { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ action }) });
            assert.equal(response.status, 202);
            await waitState(status);
        }
    } finally {
        child.kill();
        await bridge.close();
        await rm(dir, { recursive: true, force: true });
    }
});
