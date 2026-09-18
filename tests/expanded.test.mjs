import assert from "node:assert/strict";
import test from "node:test";

const { createExpandedResolver } = await import("../vencord/discordRichCards/bridge/expanded.mjs");

test("a running Dockhand container with a failed health check is degraded", async () => {
    const { expanded } = resolver({ profiles: [profile("dockhand", { baseUrl: "http://192.168.1.2:3000", environmentId: 1, containerNames: ["web"] }, { session: "native-session" })],
        responses: [{ status: 200, data: [{ name: "web", state: "running", status: "Up 2 hours (unhealthy)" }], headers: new Headers() }] });
    const result = await expanded.resolve({ provider: "dockhand", kind: "status", reference: "dockhand-profile" });
    assert.equal(result.data.status, "degraded");
    assert.equal(result.data.statusLabel, "Health check failing");
});

function profile(provider, config = {}, secret = {}) {
    return { id: `${provider}-profile`, provider, name: `${provider} profile`, config, secret };
}

function resolver({ profiles = [], integrations = {}, responses = [], now = () => 1_000_000, minecraftStatus } = {}) {
    const calls = [];
    const paidRequests = [];
    let revision = 1;
    const expanded = createExpandedResolver({
        getProfile: id => profiles.find(item => item.id === id) ?? null,
        getIntegration: provider => integrations[provider] ?? null,
        getRevision: () => revision,
        consumeXRequest: (limit, time) => { const recent = paidRequests.filter(t => t > time - 3600000); if (recent.length >= limit) return false; paidRequests.push(time); return true; },
        requestJson: async (url, options = {}) => {
            calls.push({ url, options });
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next ?? { status: 500, data: {}, headers: new Headers() };
        },
        minecraftStatus,
        now
    });
    return { expanded, calls, setRevision: value => { revision = value; } };
}

test("FiveM uses only its saved profile destination and normalizes a live summary", async () => {
    const { expanded, calls } = resolver({
        profiles: [profile("fivem", { baseUrl: "https://status.example", joinUrl: "https://cfx.re/join/demo" })],
        responses: [
            { status: 200, data: { hostname: "Paradise ERS", clients: 28, sv_maxclients: 64 }, headers: new Headers() },
            new Error("info endpoint unavailable")
        ]
    });
    const card = await expanded.resolve({ provider: "fivem", kind: "server", reference: "fivem-profile" }, false);
    assert.equal(card.version, 1);
    assert.equal(card.data.title, "Paradise ERS");
    assert.equal(card.data.status, "online");
    assert.deepEqual(card.data.fields, [{ label: "Players", value: "28 / 64" }]);
    assert.equal(card.data.url, "https://cfx.re/join/demo");
    assert.equal(calls[0].url, "https://status.example/dynamic.json");
    assert.equal(calls[0].options.localOnly, false);
    assert.equal(expanded.supports("fivem", "server"), true);
});

test("X uses only explicitly quoted references, never reply or retweet context", async () => {
    for (const type of ["replied_to", "retweeted", "quoted"]) {
        const { expanded } = resolver({ integrations: { x: profile("x", { allowPaidReads: true, maxRequestsPerHour: 5 }, { bearerToken: "fixture" }) },
            responses: [{ status: 200, data: { data: { id: "1836055593000000000", text: "Root", referenced_tweets: [{ type, id: "1836055593000000001" }] }, includes: { tweets: [{ id: "1836055593000000001", text: "Context" }] } }, headers: new Headers() }] });
        const result = await expanded.resolve({ provider: "x", kind: "post", reference: "1836055593000000000" }, true);
        assert.equal(result.data.fields.some(field => field.label === "Quoted"), type === "quoted");
    }
});

test("Minecraft uses the injected direct status helper and rejects a mismatched profile", async () => {
    const { expanded } = resolver({
        profiles: [profile("minecraft", { host: "mc.example", port: 25565 })],
        minecraftStatus: async ({ host, port }) => ({ description: { text: "Welcome" }, version: { name: "1.21" }, players: { online: 2, max: 20 }, host, port })
    });
    const card = await expanded.resolve({ provider: "minecraft", kind: "server", reference: "minecraft-profile" });
    assert.equal(card.data.status, "online");
    assert.equal(card.data.copyText, "mc.example:25565");
    assert.equal(card.data.fields[0].value, "2 / 20");
    assert.equal(card.data.description, "Welcome");
    await assert.rejects(
        expanded.resolve({ provider: "minecraft", kind: "server", reference: "fivem-profile" }),
        /profile/i
    );
});

test("Dockhand only sends the native session to its saved local profile and treats an empty selection as unknown", async () => {
    const { expanded, calls } = resolver({
        profiles: [profile("dockhand", { baseUrl: "http://192.168.1.10:3000", environmentId: 1, containerNames: ["api", "web"] }, { session: "private-cookie" })],
        responses: [{ status: 200, data: [], headers: new Headers() }]
    });
    const card = await expanded.resolve({ provider: "dockhand", kind: "status", reference: "dockhand-profile" });
    assert.equal(card.data.status, "unknown");
    assert.match(card.data.statusLabel, /No selected containers/i);
    assert.equal(calls[0].options.localOnly, true);
    assert.equal(calls[0].options.headers.cookie, "dockhand_session=private-cookie");
    assert.match(calls[0].url, /\?env=1&all=true$/);
    assert.doesNotMatch(JSON.stringify(card), /private-cookie|192\.168/);
});

test("Dockhand supports local instances without authentication and respects authentication failures", async () => {
    for (const status of [200, 401, 403]) {
        const { expanded, calls } = resolver({
            profiles: [profile("dockhand", { baseUrl: "http://192.168.1.10:3000", environmentId: 1, containerNames: ["web"] })],
            responses: [{ status, data: [{ name: "web", state: "running", status: "Up 2 hours" }], headers: new Headers() }]
        });
        const result = expanded.resolve({ provider: "dockhand", kind: "status", reference: "dockhand-profile" });
        if (status === 200) assert.equal((await result).data.status, "online");
        else await assert.rejects(result, /Dockhand/);
        assert.equal(calls.length, status === 200 ? 2 : 1);
        assert.equal(calls[0].options.localOnly, true);
        assert.deepEqual(calls[0].options.headers, {});
    }
});

test("Dockhand does not call running containers healthy without health checks or with missing selections", async () => {
    const { expanded } = resolver({
        profiles: [profile("dockhand", { baseUrl: "http://192.168.1.10", environmentId: 1, containerNames: ["api", "web"] }, { session: "private-cookie" })],
        responses: [{ status: 200, data: [{ name: "api", state: "running", status: "Up 2 hours" }], headers: new Headers() }]
    });
    const card = await expanded.resolve({ provider: "dockhand", kind: "status", reference: "dockhand-profile" });
    assert.equal(card.data.status, "unknown");
    assert.equal(card.data.statusLabel, "Selected containers unavailable");
});

test("Dockhand shows selected container details and recorded updates without inferring deployment dates", async () => {
    const { expanded, calls } = resolver({
        profiles: [profile("dockhand", { baseUrl: "http://192.168.1.10", environmentId: 1, containerNames: ["web", "worker", "missing"] })],
        responses: [
            { status: 200, data: [{ id: "a", name: "web", image: "example/web:latest", state: "running", status: "Up 2 hours", created: 1789690259 }, { id: "b", name: "worker", state: "exited", status: "Exited", created: -1 }], headers: new Headers() },
            { status: 200, data: { pendingUpdates: [{ containerId: "a", checkedAt: "2026-09-18T08:00:12.330Z" }, { containerId: "other", checkedAt: "bad" }] }, headers: new Headers() }
        ]
    });
    const { data } = await expanded.resolve({ provider: "dockhand", kind: "status", reference: "dockhand-profile" });
    assert.deepEqual(data.containers.map(item => [item.name, item.updateStatus]), [["web", "available"], ["worker", "none-reported"], ["missing", "unknown"]]);
    assert.equal(data.containers[0].createdAt, new Date(1789690259000).toISOString());
    assert.equal(data.containers[0].updateCheckedAt, "2026-09-18T08:00:12.330Z");
    assert.equal(data.containers[1].createdAt, undefined);
    assert.equal(calls[1].options.localOnly, true);
    assert.equal(calls[1].options.method, undefined);
    assert.match(calls[1].url, /\/pending-updates\?env=1$/);
});

test("Statuspage, Spotify, Twitch, Steam and YouTube produce bounded SummaryCards", async () => {
    const { expanded } = resolver({
        profiles: [profile("statuspage", { baseUrl: "https://status.example" })],
        integrations: {
            spotify: profile("spotify", { clientId: "client" }, { clientSecret: "secret" }),
            twitch: profile("twitch", { clientId: "client" }, { clientSecret: "secret" }),
            youtube: profile("youtube", {}, { apiKey: "key" }),
            steam: profile("steam", { country: "us" })
        },
        responses: [
            { status: 200, data: { page: { name: "Example" }, status: { indicator: "minor", description: "Minor outage" }, incidents: [{ name: "Slow" }] }, headers: new Headers() },
            { status: 200, data: { access_token: "spotify-token", expires_in: 3600 }, headers: new Headers() },
            { status: 200, data: { name: "Song", artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/image/x" }] }, external_urls: { spotify: "https://open.spotify.com/track/123" } }, headers: new Headers() },
            { status: 200, data: { access_token: "twitch-token", expires_in: 3600 }, headers: new Headers() },
            { status: 200, data: { data: [{ user_name: "Streamer", title: "Live", game_name: "Game", viewer_count: 42, started_at: "2026-01-01T00:00:00Z", thumbnail_url: "https://static-cdn.jtvnw.net/x.jpg" }] }, headers: new Headers() },
            { status: 200, data: { 10: { success: true, data: { name: "Game", header_image: "https://cdn.akamai.steamstatic.com/x.jpg", price_overview: { final_formatted: "$4.99", discount_percent: 50 } } } }, headers: new Headers() },
            { status: 200, data: { response: { player_count: 99 } }, headers: new Headers() },
            { status: 200, data: { items: [{ snippet: { title: "Event", channelTitle: "Channel", thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } } }, liveStreamingDetails: { scheduledStartTime: "2026-02-01T00:00:00Z", concurrentViewers: "12" } }] }, headers: new Headers() }
        ]
    });
    assert.equal((await expanded.resolve({ provider: "statuspage", kind: "status", reference: "statuspage-profile" })).data.status, "degraded");
    assert.equal((await expanded.resolve({ provider: "spotify", kind: "track", reference: "1234567890123456789012" })).data.title, "Song");
    assert.equal((await expanded.resolve({ provider: "twitch", kind: "channel", reference: "streamer" })).data.status, "live");
    assert.equal((await expanded.resolve({ provider: "steam", kind: "game", reference: "10" })).data.fields[0].value, "$4.99 (50% off)");
    const youtube = await expanded.resolve({ provider: "youtube", kind: "live", reference: "abcdefghijk" });
    assert.equal(youtube.data.status, "scheduled");
    assert.equal(youtube.data.fields[0].value, "12");
});

test("X requires explicit paid manual reads and never refreshes from background polling", async () => {
    const integration = profile("x", { allowPaidReads: true, maxRequestsPerHour: 1 }, { bearerToken: "x-secret" });
    const { expanded, calls } = resolver({
        integrations: { x: integration },
        responses: [{ status: 200, data: { data: { id: "18446744073709551615", text: "Hello", created_at: "2026-01-01T00:00:00Z", author_id: "a", referenced_tweets: [{ type: "quoted", id: "other" }], attachments: { media_keys: ["main-photo"] } }, includes: { users: [{ id: "a", name: "Alice", username: "alice" }], tweets: [{ id: "other", text: "Quoted context" }], media: [{ type: "photo", media_key: "unrelated", url: "https://pbs.twimg.com/media/other.jpg" }, { type: "photo", media_key: "main-photo", url: "https://pbs.twimg.com/media/card.jpg" }] } }, headers: new Headers() }]
    });
    await assert.rejects(expanded.resolve({ provider: "x", kind: "post", reference: "18446744073709551615" }), /manual refresh/i);
    const card = await expanded.resolve({ provider: "x", kind: "post", reference: "18446744073709551615" }, true);
    assert.equal(card.data.title, "Alice");
    assert.equal(card.data.description, "Hello");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.authorization, "Bearer x-secret");
    assert.equal(card.data.imageUrl, "https://pbs.twimg.com/media/card.jpg");
    assert.equal(card.data.fields[0].value, "Quoted context");
    assert.doesNotMatch(JSON.stringify(card), /x-secret/);
});

test("Twitch keeps its native token metadata while resolving a later channel refresh", async () => {
    let now = 1_000_000;
    const { expanded } = resolver({
        now: () => now,
        integrations: { twitch: profile("twitch", { clientId: "client" }, { clientSecret: "secret" }) },
        responses: [
            { status: 200, data: { access_token: "token", expires_in: 3600 }, headers: new Headers() },
            { status: 200, data: { data: [] }, headers: new Headers() },
            { status: 200, data: { data: [] }, headers: new Headers() }
        ]
    });
    await expanded.resolve({ provider: "twitch", kind: "channel", reference: "streamer" });
    now += 5_001;
    assert.equal((await expanded.resolve({ provider: "twitch", kind: "channel", reference: "streamer" }, true)).data.status, "offline");
});

test("manual gates, rate limits, cache invalidation, and stale in-flight replies cannot repopulate a profile", async () => {
    let now = 1_000_000;
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const { expanded, calls, setRevision } = resolver({
        profiles: [profile("fivem", { baseUrl: "https://status.example" })],
        now: () => now,
        responses: [
            delayed,
            { status: 200, data: {}, headers: new Headers() },
            { status: 429, data: {}, headers: new Headers() },
            { status: 200, data: {}, headers: new Headers() }
        ]
    });
    const old = expanded.resolve({ provider: "fivem", kind: "server", reference: "fivem-profile" }, true);
    setRevision(2);
    release({ status: 200, data: { hostname: "old", clients: 1, sv_maxclients: 2 }, headers: new Headers() });
    await assert.rejects(old, /changed/i);
    await assert.rejects(expanded.resolve({ provider: "fivem", kind: "server", reference: "fivem-profile" }, true), /rate limit/i);
    now += 1_000;
    await assert.rejects(expanded.resolve({ provider: "fivem", kind: "server", reference: "fivem-profile" }, true), /rate limit/i);
    assert.equal(calls.length, 4, "FiveM reads dynamic and info endpoints for each accepted attempt");
});

test("the runtime delegates supported provider routes through native provider options", async t => {
    const { createBridge } = await import("../vencord/discordRichCards/bridge/runtime.mjs");
    const bridge = createBridge({
        host: "127.0.0.1", port: 0,
        providerOptions: {
            getProfile: id => id === "fivem-profile" ? profile("fivem", { baseUrl: "https://status.example" }) : null,
            getIntegration: () => null,
            getRevision: () => 1,
            requestJson: async url => ({ status: 200, data: url.endsWith("dynamic.json") ? { hostname: "Runtime", clients: 1, sv_maxclients: 2 } : {}, headers: new Headers() }),
            minecraftStatus: async () => ({})
        }
    });
    await bridge.listen();
    t.after(() => bridge.close());
    const response = await fetch(`http://127.0.0.1:${bridge.port}/api/cards/fivem/server/fivem-profile`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.title, "Runtime");
});
