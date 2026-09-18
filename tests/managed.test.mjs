import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedBridge } from "../vencord/discordRichCards/bridge/managed.mjs";

test("managed bridge starts once, authenticates locally, persists, and stops across enable cycles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "richcards-managed-"));
    const manager = createManagedBridge({ dataFile: join(directory, "cards.json") });
    try {
        await assert.rejects(manager.connection(), /disabled/);
        const [first, second] = await Promise.all([manager.start(), manager.start()]);
        assert.deepEqual(first, second);
        assert.equal(new URL(first.url).hostname, "127.0.0.1");
        assert.equal(first.token.length, 64);
        assert.equal((await fetch(`${first.url}/api/sessions`)).status, 401);
        const headers = { authorization: `Bearer ${first.token}`, "content-type": "application/json" };
        assert.equal((await fetch(`${first.url}/api/sessions/demo`, { method: "PUT", headers, body: JSON.stringify({ title: "Saved", status: "success" }) })).status, 200);
        await manager.stop();
        await assert.rejects(manager.connection(), /disabled/);
        await assert.rejects(fetch(`${first.url}/health`));
        const restarted = await manager.start();
        assert.notEqual(restarted.token, first.token);
        const state = await fetch(`${restarted.url}/api/sessions/demo`, { headers: { authorization: `Bearer ${restarted.token}` } });
        assert.equal((await state.json()).title, "Saved");
        const starting = manager.start();
        const stopping = manager.stop();
        await Promise.allSettled([starting, stopping]);
        await assert.rejects(manager.connection(), /disabled/);
    } finally {
        await manager.stop();
        await rm(directory, { recursive: true, force: true });
    }
});
