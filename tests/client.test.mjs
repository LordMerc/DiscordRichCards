import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkers, parseGitHubPRRef, parseRobloxGameRef } from "../vencord/discordRichCards/marker.ts";
import { startPolling } from "../vencord/discordRichCards/polling.ts";
import { validateHermes, validateGitHub, validateRoblox } from "../vencord/discordRichCards/validation.ts";
import { MANUAL_REFRESH_COOLDOWN_MS, getManualRefreshCooldownRemaining, getRefreshLabel } from "../vencord/discordRichCards/refresh.ts";
import { currentRobloxEvents } from "../vencord/discordRichCards/bridge/robloxEvents.mjs";

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

 test("Roblox markers and normalized data reject invalid IDs and counts", () => {
    const ref = "129932912185311";
    assert.equal(parseRobloxGameRef(ref), 129932912185311);
    assert.equal(parseMarkers("[[richcard:roblox:game:" + ref + "]]")[0].reference, ref);
    for (const value of ["0", "01", "-1", "9007199254740992", "https://roblox.com/games/1", "1?x=2"]) assert.equal(parseRobloxGameRef(value), null);
    const data = {placeId: 129932912185311, universeId: 8946565814, name: "Anime Origins", creator: "Origins Project", playing: 1234, favorites: 25000, visits: null, status: "open", statusReason: "Public and active", updatedAt: "2026-09-17T00:00:00Z"};
    assert.equal(validateRoblox(data), true);
    const event = { id: "4943114036414907040", title: "Update", startsAt: "2026-09-18T12:00:00Z", endsAt: "2026-09-19T12:00:00Z" };
    assert.equal(validateRoblox({...data, events: [event], eventsStatus: "ready", eventsTruncated: false}), true);
    for (const fields of [{events: {}}, {events: [{...event, id: "javascript:alert(1)"}]}, {events: [{...event, endsAt: event.startsAt}]}, {eventsStatus: "bogus"}, {eventsTruncated: "yes"}]) {
        assert.equal(validateRoblox({...data, ...fields}), false);
    }
    assert.equal(validateRoblox({...data, playing: null, status: "private"}), true);
    for (const invalid of [{playing: -1}, {favorites: "2"}, {visits: 1.2}, {status: "GuestProhibited"}, {placeId: 0}, {iconUrl: "http://tr.rbxcdn.com/icon"}, {thumbnailUrl: "https://rbxcdn.com.evil.example/image"}, {iconUrl: "https://user:pass@tr.rbxcdn.com/icon"}]) assert.equal(validateRoblox({...data, ...invalid}), false);
});

test("manual refresh labels hold a five-second cooldown independently of request state", () => {
    const now = 1_000_000;
    const until = now + MANUAL_REFRESH_COOLDOWN_MS;
    assert.equal(getManualRefreshCooldownRemaining(until, now), 5_000);
    assert.equal(getRefreshLabel(true, getManualRefreshCooldownRemaining(until, now)), "Refresh (5s)");
    assert.equal(getRefreshLabel(false, getManualRefreshCooldownRemaining(until, now + 1_001)), "Refresh (4s)");
    assert.equal(getRefreshLabel(true, getManualRefreshCooldownRemaining(until, until)), "Refreshing…");
    assert.equal(getRefreshLabel(false, getManualRefreshCooldownRemaining(until, until)), "Refresh");
});

test("cached Roblox schedules expire at their end time without a new upstream response", () => {
    const live = { id: "1", title: "Live", startsAt: "2026-09-18T11:00:00Z", endsAt: "2026-09-18T13:00:00Z" };
    const upcoming = { id: "2", title: "Next", startsAt: "2026-09-18T14:00:00Z", endsAt: "2026-09-18T15:00:00Z" };
    const cached = [upcoming, live];
    assert.deepEqual(currentRobloxEvents(cached, Date.parse("2026-09-18T12:00:00Z")).map(e => e.id), ["1", "2"]);
    assert.deepEqual(currentRobloxEvents(cached, Date.parse("2026-09-18T13:00:00Z")).map(e => e.id), ["2"]);
    assert.deepEqual(cached.map(e => e.id), ["2", "1"], "rendering does not mutate the shared cache");
});
