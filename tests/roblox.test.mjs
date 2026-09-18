import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { createBridge } = await import("../bridge/server.mjs");

function tempDataFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richcards-roblox-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, "state.json");
}

async function running(t, options = {}) {
    const bridge = createBridge({ host: "127.0.0.1", port: 0, ...options });
    await bridge.listen();
    t.after(() => bridge.close());
    return `http://127.0.0.1:${bridge.port}`;
}

function response(status, body) {
    return new Response(body == null ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
    });
}

const placeId = 129932912185311;
const universeId = 8946565814;
const details = {
    data: [{
        id: universeId,
        name: "Anime Origins",
        creator: { name: "Origins Project" },
        playing: 1334,
        favoritedCount: 25812,
        visits: 25604812,
        updated: "2026-09-11T14:38:15.766Z"
    }]
};

function publicUniverse(overrides = {}) {
    return {
        id: universeId,
        name: "Anime Origins",
        creatorName: "Origins Project",
        privacyType: "Public",
        isActive: true,
        isArchived: false,
        updated: "2026-09-05T21:02:14.167Z",
        ...overrides
    };
}

function robloxFetch(calls, options = {}) {
    return async (url, requestOptions) => {
        if (url.startsWith("https://thumbnails.roblox.com/")) return response(200, {data:[]});
        calls.push({ url, ...requestOptions });
        if (options.fail) throw new Error("network unavailable");
        if (url === `https://apis.roblox.com/universes/v1/places/${placeId}/universe`) return response(200, { universeId });
        if (url === `https://games.roblox.com/v1/games?universeIds=${universeId}`) return options.detailsResponse ?? response(200, details);
        if (url === `https://develop.roblox.com/v1/universes/${universeId}`) return options.universeResponse ?? response(200, publicUniverse());
        throw new Error(`unexpected URL ${url}`);
    };
}

test("Roblox game cards use public game and universe data without treating guest playability as locked", async t => {
    const calls = [];
    const base = await running(t, { dataFile: tempDataFile(t), fetch: robloxFetch(calls) });
    const result = await (await fetch(`${base}/api/cards/roblox/game/${placeId}`)).json();

    assert.equal(result.provider, "roblox");
    assert.equal(result.kind, "game");
    assert.deepEqual(result.data, {
        placeId,
        universeId,
        name: "Anime Origins",
        creator: "Origins Project",
        playing: 1334,
        favorites: 25812,
        visits: 25604812,
        iconUrl: null,
        thumbnailUrl: null,
        status: "open",
        statusReason: "This experience is public and active",
        updatedAt: "2026-09-11T14:38:15.766Z"
    });
    assert.equal(result.refreshAfterMs, 30_000);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.redirect === "error" && call.headers.authorization === undefined));
    assert.ok(calls.every(call => call.signal instanceof AbortSignal));
    assert.ok(calls.every(call => !call.url.includes("playability")));
});

test("Roblox availability status is explicit and preserves unknown availability", async t => {
    const cases = [
        [publicUniverse({ privacyType: "Private" }), "private", "This experience is private"],
        [publicUniverse({ isActive: false }), "locked", "This experience is inactive"],
        [publicUniverse({ privacyType: "" }), "unknown", "Roblox availability could not be confirmed"]
    ];
    for (const [universe, status, statusReason] of cases) {
        const calls = [];
        const base = await running(t, {
            dataFile: tempDataFile(t),
            fetch: robloxFetch(calls, { universeResponse: response(200, universe) })
        });
        const result = await (await fetch(`${base}/api/cards/roblox/game/${placeId}`)).json();
        assert.equal(result.data.status, status);
        assert.equal(result.data.statusReason, statusReason);
        if (status === "unknown") assert.match(result.warning, /availability could not be confirmed/);
    }
});

test("Roblox cards keep only safe integer counters and persist partial-data warnings", async t => {
    const calls = [];
    const base = await running(t, {
        dataFile: tempDataFile(t),
        fetch: robloxFetch(calls, {
            detailsResponse: response(200, {
                data: [{ ...details.data[0], playing: 1.5, favoritedCount: Number.MAX_SAFE_INTEGER + 1, visits: -1 }]
            }),
            universeResponse: response(500, {})
        })
    });
    const route = `/api/cards/roblox/game/${placeId}`;
    const first = await (await fetch(`${base}${route}`)).json();
    assert.equal(first.data.playing, null);
    assert.equal(first.data.favorites, null);
    assert.equal(first.data.visits, null);
    assert.match(first.warning, /availability could not be confirmed/);
    const cached = await (await fetch(`${base}${route}`)).json();
    assert.equal(cached.warning, first.warning, "cached partial data keeps its warning");
});

test("Roblox cards retain a stale card after a failed refresh and gate repeat manual refreshes", async t => {
    const calls = [];
    let now = 1_000_000;
    let fail = false;
    const dataFile = tempDataFile(t);
    const base = await running(t, {
        dataFile,
        now: () => now,
        fetch: async (url, options) => robloxFetch(calls, { fail })(url, options)
    });
    const route = `/api/cards/roblox/game/${placeId}`;
    assert.equal((await fetch(`${base}${route}`)).status, 200);
    const refreshed = await (await fetch(`${base}${route}?refresh=1`)).json();
    assert.equal(refreshed.data.playing, 1334);
    const deferred = await (await fetch(`${base}${route}?refresh=1`)).json();
    assert.equal(deferred.refreshDeferredMs, 5_000);
    assert.equal(calls.length, 5, "a repeated manual refresh does not repeat Roblox requests");
    now += 5_000;
    fail = true;
    const stale = await (await fetch(`${base}${route}?refresh=1`)).json();
    assert.equal(stale.stale, true);
    assert.equal(stale.warning, "Roblox is temporarily unavailable");
    assert.equal(stale.data.playing, 1334);
    assert.equal(calls.length, 7, "the cached universe avoids a second place lookup during refresh");
});

test("concurrent Roblox card requests share one upstream refresh", async t => {
    const calls = [];
    let release;
    const waitForDetails = new Promise(resolve => {
        release = resolve;
    });
    const base = await running(t, {
        dataFile: tempDataFile(t),
        fetch: async (url, options) => {
            if (url.startsWith("https://thumbnails.roblox.com/")) return response(200, {data:[]});
            calls.push({ url, ...options });
            if (url === `https://apis.roblox.com/universes/v1/places/${placeId}/universe`) return response(200, { universeId });
            await waitForDetails;
            if (url === `https://games.roblox.com/v1/games?universeIds=${universeId}`) return response(200, details);
            if (url === `https://develop.roblox.com/v1/universes/${universeId}`) return response(200, publicUniverse());
            throw new Error(`unexpected URL ${url}`);
        }
    });
    const route = `${base}/api/cards/roblox/game/${placeId}`;
    const first = fetch(route);
    const second = fetch(route);
    await new Promise(resolve => setImmediate(resolve));
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal(calls.length, 3);
});

test("a partial Roblox rate limit backs off cached cards for one minute", async t => {
    const calls = [];
    let now = 1_000_000;
    let rateLimited = false;
    const base = await running(t, {
        dataFile: tempDataFile(t),
        now: () => now,
        fetch: async (url, options) => {
            if (url.startsWith("https://thumbnails.roblox.com/")) return response(200, {data:[]});
            calls.push({ url, ...options });
            if (url === `https://apis.roblox.com/universes/v1/places/${placeId}/universe`) return response(200, { universeId });
            if (url === `https://games.roblox.com/v1/games?universeIds=${universeId}`) return rateLimited ? response(429, {}) : response(200, details);
            if (url === `https://develop.roblox.com/v1/universes/${universeId}`) return response(200, publicUniverse());
            throw new Error(`unexpected URL ${url}`);
        }
    });
    const route = `${base}/api/cards/roblox/game/${placeId}`;
    assert.equal((await fetch(route)).status, 200);
    now += 5_000;
    rateLimited = true;
    const stale = await (await fetch(`${route}?refresh=1`)).json();
    assert.equal(stale.stale, true);
    assert.equal(stale.warning, "Roblox rate limit reached; try again later");
    assert.equal(calls.length, 5);
    now += 59_999;
    assert.equal((await fetch(`${route}?refresh=1`)).status, 200);
    assert.equal(calls.length, 5, "the rate-limit backoff prevents repeated upstream calls");
    now += 1;
    rateLimited = false;
    assert.equal((await fetch(`${route}?refresh=1`)).status, 200);
    assert.equal(calls.length, 7);
});

test("Roblox game references reject invalid place IDs before reaching an upstream", async t => {
    let calls = 0;
    const base = await running(t, {
        dataFile: tempDataFile(t),
        fetch: async () => {
            calls++;
            return response(200, {});
        }
    });
    for (const reference of ["0", "-1", "1.5", "01", "9007199254740992"]) {
        assert.equal((await fetch(`${base}/api/cards/roblox/game/${reference}`)).status, 400);
    }
    assert.equal(calls, 0);
});

test("Roblox artwork uses completed CDN images, caches them, and degrades independently", async t => {
    let now = 1_000_000;
    let imageCalls = 0;
    let mode = "ok";
    const icon = "https://tr.rbxcdn.com/icon/150/150/Image/Png/noFilter";
    const thumbnail = "https://tr.rbxcdn.com/banner/768/432/Image/Png/noFilter";
    const base = await running(t, { dataFile: tempDataFile(t), now: () => now, fetch: async (url, opts) => {
        if (!url.startsWith("https://thumbnails.roblox.com/")) return robloxFetch([])(url, opts);
        imageCalls++;
        assert.equal(opts.redirect, "error");
        assert.equal(opts.headers.authorization, undefined);
        if (mode === "offline") throw Error("offline");
        if (url.includes("/icons?")) return response(200, {data:[{targetId:universeId,state:mode === "pending" ? "Pending" : "Completed", imageUrl:mode === "unsafe" ? "https://evil.example/image.png" : icon}]});
        return response(200, {data:[{universeId,thumbnails:[{state:"Completed",imageUrl:mode === "unsafe" ? "https://tr.rbxcdn.com.evil.example/image.png" : thumbnail}]}]});
    }});
    const route = base + "/api/cards/roblox/game/" + placeId;
    let result = await (await fetch(route)).json();
    assert.equal(result.data.iconUrl, icon);
    assert.equal(result.data.thumbnailUrl, thumbnail);
    now += 30000;
    result = await (await fetch(route)).json();
    assert.equal(imageCalls, 2, "stats refresh does not refetch artwork");
    assert.equal(result.data.iconUrl, icon);
    now += 300000;
    mode = "unsafe";
    result = await (await fetch(route)).json();
    assert.equal(result.data.iconUrl, null);
    assert.equal(result.data.thumbnailUrl, null);
    assert.equal(result.data.playing, 1334);
    now += 300000;
    mode = "pending";
    result = await (await fetch(route)).json();
    assert.equal(result.data.iconUrl, null);
    assert.equal(result.data.thumbnailUrl, thumbnail);
    now += 300000;
    mode = "offline";
    result = await (await fetch(route)).json();
    assert.equal(result.data.playing, 1334, "artwork failure does not fail counters");
    assert.equal(result.data.status, "open");
});
