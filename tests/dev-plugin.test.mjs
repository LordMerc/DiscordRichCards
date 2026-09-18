import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateDevPlugin } from "../scripts/dev-plugin.mjs";

test("development plugin has separate identity, cache, styles and marker grammar", async t => {
    const dir = await mkdtemp(join(tmpdir(), "richcards-dev-test-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const target = join(dir, "discordRichCardsDev");
    assert.throws(() => generateDevPlugin(join(dir, "discordRichCards")), /discordRichCardsDev/);
    generateDevPlugin(target);
    const read = name => readFile(join(target, name), "utf8");
    assert.match(await read("index.tsx"), /name: "DiscordRichCardsDev"/);
    assert.match(await read("index.tsx"), /href="https:\/\/github\.com\/LordMerc\/DiscordRichCards"/);
    assert.doesNotMatch(await read("index.tsx"), /github\.com\/LordMerc\/DiscordRichCardsDev/);
    assert.match(await read("settings.ts"), /pluginHelpers.DiscordRichCardsDev/);
    assert.match(await read("native.ts"), /"discord-richcards-dev"/);
    assert.doesNotMatch(await read("styles.css"), /\.hermes-live-|\.rich-card[ {.-]/);
    const { buildComposerInsertion, parseComposerLink, parseMarkers } = await import(pathToFileURL(join(target, "marker.ts")));
    assert.equal(parseMarkers("[[richcard-dev:roblox:game:129932912185311]]").length, 1);
    assert.equal(parseMarkers("[[richcard-dev<:roblox:123>game:129932912185311]]").length, 1);
    for (const marker of ["[[richcard:roblox:game:1]]", "[[richcard:github:pr:a/b#1]]", "hermes-live:demo", "[[hermes-live:demo]]"]) assert.equal(parseMarkers(marker).length, 0, marker);
    assert.match(buildComposerInsertion(parseComposerLink("https://github.com/LordMerc/DiscordRichCards/pull/2"), false), /^\[\[richcard-dev:github:pr:/);
});
