import assert from "node:assert/strict";
import { test } from "node:test";
import { parseComposerLink, buildComposerInsertion } from "../vencord/discordRichCards/marker.ts";
import * as expandedClient from "../vencord/discordRichCards/expandedClient.ts";
import { formatSummaryField, validateSummary, spotifyActivity } from "../vencord/discordRichCards/expandedClient.ts";

test("summary counts use locale grouping without changing prices or text", () => {
    const formatted = new Intl.NumberFormat().format(1314203);
    assert.equal(formatSummaryField({ label: "Playing now", value: "1314203" }), formatted);
    assert.equal(formatSummaryField({ label: "Players", value: "1314203 / 2000000" }), `${formatted} / ${new Intl.NumberFormat().format(2000000)}`);
    for (const field of [{ label: "Price", value: "1999" }, { label: "Quoted", value: "1314203" }, { label: "Viewers", value: "Unknown" }]) assert.equal(formatSummaryField(field), field.value);
});

test("composer canonicalizes new public providers without accepting credentialed or unrelated links", () => {
    const examples = [
        ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=private", "spotify", "track", "4uLU6hMCjMI75M1A2tKUQC"],
        ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "spotify", "playlist", "37i9dQZF1DXcBWIGoYBM5M"],
        ["https://twitch.tv/Test_Channel", "twitch", "channel", "test_channel"],
        ["https://store.steampowered.com/app/730/CounterStrike_2/", "steam", "game", "730"],
        ["https://youtu.be/dQw4w9WgXcQ?t=10", "youtube", "live", "dQw4w9WgXcQ"],
        ["https://x.com/example/status/1836055593000000000", "x", "post", "1836055593000000000"]
    ];
    for (const [url, provider, kind, reference] of examples) {
        const card = parseComposerLink(url);
        assert.deepEqual(card && [card.provider, card.kind, card.reference], [provider, kind, reference]);
        assert.equal(card.url.includes("private"), false);
    }
    for (const url of ["https://twitch.tv/directory", "https://user@open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "https://x.com.evil.test/u/status/123", "http://youtube.com/watch?v=dQw4w9WgXcQ"]) assert.equal(parseComposerLink(url), null);
    assert.equal(buildComposerInsertion({ provider: "dockhand", kind: "status", reference: "profile-id", url: "" }, true), "[[richcard:dockhand:status:profile-id]] ");
});

test("summary validation rejects unsafe artwork/actions and non-text fields", () => {
    const base = { title: "Test", status: "live", statusLabel: "Live", fields: [{ label: "Players", value: "4" }] };
    assert.equal(validateSummary(base), true);
    assert.equal(validateSummary({ ...base, imageUrl: "https://password@i.scdn.co/image/example" }), false);
    assert.equal(validateSummary({ ...base, imageUrl: "https://i.scdn.co:444/image/example" }), false);
    assert.equal(validateSummary({ ...base, url: "javascript:alert(1)" }), false);
    assert.equal(validateSummary({ ...base, url: "https://untrusted.test" }), false);
    assert.equal(validateSummary({ ...base, fields: [{ label: "Users", value: {} }] }), false);
    const container = { name: "web", state: "running", status: "Up 2 hours", image: "nginx:stable", updateStatus: "available", createdAt: "2026-09-18T00:00:00.000Z", updateCheckedAt: "2026-09-18T00:01:00.000Z" };
    assert.equal(validateSummary({ ...base, containers: [container] }), true);
    assert.equal(validateSummary({ ...base, containers: [{ ...container, updateStatus: "pending" }] }), false);
    assert.equal(validateSummary({ ...base, containers: [{ ...container, createdAt: "not-a-date" }] }), false);
    assert.equal(validateSummary({ ...base, containers: [{ ...container, updateCheckedAt: "not-a-date" }] }), false);
    assert.equal(validateSummary({ ...base, containers: Array.from({ length: 51 }, () => container) }), false);
});

test("Spotify activity follows supplied visible presence and expires without guessing pause state", () => {
    const activity = { type: 2, name: "Spotify", sync_id: "4uLU6hMCjMI75M1A2tKUQC", details: "Song", state: "Artist", timestamps: { start: 1000, end: 181000 }, assets: { large_image: "spotify:" + "a".repeat(40), large_text: "Album" } };
    const current = spotifyActivity([activity], 61000);
    assert.equal(current.title, "Song");
    assert.equal(current.elapsedMs, 60000);
    assert.equal(current.durationMs, 180000);
    assert.equal(spotifyActivity([], 61000), null);
    assert.equal(spotifyActivity([activity], 181001), null);
    assert.equal(spotifyActivity([{ ...activity, name: "Other" }], 61000), null);
});

test("Spotify activity uses locally published activities only for the current user", () => {
    const selectActivities = expandedClient.spotifyActivitiesForUser;
    assert.equal(typeof selectActivities, "function");
    if (typeof selectActivities !== "function") return;
    const localActivities = [{ source: "local" }];
    const presenceActivities = [{ source: "presence" }];
    const noLocalActivities = [];
    assert.equal(selectActivities("326081760108740608", "326081760108740608", localActivities, presenceActivities), localActivities);
    assert.equal(selectActivities("another-user", "326081760108740608", localActivities, presenceActivities), presenceActivities);
    assert.equal(selectActivities("326081760108740608", "326081760108740608", noLocalActivities, presenceActivities), noLocalActivities);
});
