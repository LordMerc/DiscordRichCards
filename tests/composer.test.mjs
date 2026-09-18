import assert from "node:assert/strict";
import { test } from "node:test";
import { buildComposerInsertion, parseComposerLink, parseMarkers } from "../vencord/discordRichCards/marker.ts";

test("composer recognizes the Codex tracker and rejects unrelated paths and hosts", () => {
    const card = parseComposerLink("https://hascodexratelimitreset.today");
    assert.deepEqual(card, { provider: "codex", kind: "reset", reference: "today", url: "https://hascodexratelimitreset.today/" });
    assert.equal(buildComposerInsertion(card, false), "[[richcard:codexreset]] ");
    const markers = parseMarkers("[[richcard:codexreset]] [[richcard:codex:reset:today]]");
    assert.equal(markers.length, 2);
    for (const marker of markers) assert.deepEqual([marker.provider, marker.kind, marker.reference], ["codex", "reset", "today"]);
    for (const url of ["http://hascodexratelimitreset.today", "https://hascodexratelimitreset.today/admin", "https://hascodexratelimitreset.today.evil.example", "https://user:pass@hascodexratelimitreset.today", "https://hascodexratelimitreset.today:444"]) {
        assert.equal(parseComposerLink(url), null);
    }
});

test("composer recognizes canonical GitHub pull request and Roblox game links", () => {
    assert.deepEqual(parseComposerLink("https://github.com/LordMerc/DiscordRichCards/pull/2"), {
        provider: "github",
        kind: "pr",
        reference: "LordMerc/DiscordRichCards#2",
        url: "https://github.com/LordMerc/DiscordRichCards/pull/2"
    });
    assert.deepEqual(parseComposerLink("https://www.roblox.com/games/84515722934860/Anime-Expeditions"), {
        provider: "roblox",
        kind: "game",
        reference: "84515722934860",
        url: "https://www.roblox.com/games/84515722934860/Anime-Expeditions"
    });
});

test("composer rejects noncanonical, credentialed, or malformed provider links", () => {
    for (const link of [
        "http://github.com/owner/repo/pull/1",
        "https://github.com/owner/repo/issues/1",
        "https://github.com/owner/repo/pull/1/files",
        "https://user:pass@github.com/owner/repo/pull/1",
        "https://github.com:444/owner/repo/pull/1",
        "https://github.com.evil.example/owner/repo/pull/1",
        "https://www.roblox.com/games/0/example",
        "https://www.roblox.com/games/01/example",
        "https://www.roblox.com/games/84515722934860/example/extra",
        "https://roblox.com.evil.example/games/84515722934860/example"
    ]) assert.equal(parseComposerLink(link), null, link);
});

test("composer inserts one marker and optionally preserves the canonical link", () => {
    const card = parseComposerLink("https://github.com/LordMerc/DiscordRichCards/pull/2");
    assert.ok(card);
    assert.equal(buildComposerInsertion(card, true), "[[richcard:github:pr:LordMerc/DiscordRichCards#2]] https://github.com/LordMerc/DiscordRichCards/pull/2 ");
    assert.equal(buildComposerInsertion(card, false), "[[richcard:github:pr:LordMerc/DiscordRichCards#2]] ");
});
