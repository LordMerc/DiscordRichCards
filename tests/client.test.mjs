import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkers, parseGitHubPRRef } from "../vencord/discordRichCards/marker.ts";
import { startPolling } from "../vencord/discordRichCards/polling.ts";
import { validateHermes, validateGitHub } from "../vencord/discordRichCards/validation.ts";

test("durable legacy and generic anchors normalize in message order", () => {
    const cards = parseMarkers("fallback [[hermes-live:demo-001]] [[richcard:github:pr:Vendicated/Vencord#4607]] [[richcard:hermes:session:demo-001]]");
    assert.equal(cards.length, 3);
    assert.equal(cards[0].reference, cards[2].reference);
    assert.equal(cards[0].provider, "hermes");
    assert.deepEqual(parseGitHubPRRef(cards[1].reference), { owner: "Vendicated", repo: "Vencord", number: 4607 });
    assert.deepEqual(parseMarkers(cards.map(c => c.rawMarker).join(" ")), cards);
});

test("polling recovers, stops on unmount, and fetches immediately on re-entry", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let attempts = 0;
    const poll = async () => { attempts++; if (attempts === 1) throw new Error("offline"); return 30000; };
    const stop = startPolling(poll, 30000);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(attempts, 1);
    t.mock.timers.tick(30000);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(attempts, 2);
    stop(); t.mock.timers.tick(60000);
    assert.equal(attempts, 2);
    const stopAgain = startPolling(poll, 30000);
    assert.equal(attempts, 3);
    stopAgain(); await Promise.resolve();
    t.mock.timers.tick(60000);
    assert.equal(attempts, 3);
});

test("malformed bridge data is rejected before React renders it", () => {
    assert.equal(validateHermes({ version: 1, sessionId: "demo", title: "Demo", status: "running", activity: [] }), true);
    assert.equal(validateHermes({ version: 1, sessionId: "demo", title: {}, status: "running" }), false);
    assert.equal(validateGitHub({ title: "PR", labels: [{}] }), false);
});

test("invalid references and unknown providers stay explicit instead of selecting another card", () => {
    assert.equal(parseMarkers("[[richcard:github:pr:bad]]")[0].reference, "bad");
    assert.equal(parseMarkers("[[richcard:future:thing:abc]]")[0].provider, "future");
    for (const ref of ["owner/repo#0", "../repo#1", "owner/repo#1/extra", "owner/repo#9007199254740992", "owner/repo#1?token=x"]) {
        assert.equal(parseGitHubPRRef(ref), null, ref);
    }
    assert.equal(parseMarkers("ordinary fallback text").length, 0);
    assert.equal(parseMarkers("`hermes-live:demo-002`")[0].reference, "demo-002");
});

test("Discord custom emoji substitution preserves the GitHub provider delimiter", () => {
    for (const emoji of ["<:github:123456789012345678>", "<a:github:123456789012345678>"]) {
        const rawMarker = `[[richcard${emoji}pr:Vendicated/Vencord#4608]]`;
        assert.deepEqual(parseMarkers(rawMarker), [{
            provider: "github", kind: "pr", reference: "Vendicated/Vencord#4608", rawMarker
        }]);
    }
});
