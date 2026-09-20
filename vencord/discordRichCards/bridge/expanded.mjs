import { bridgeTtlMs, isBridgeBacked } from "./providers.mjs";

const MANUAL_GATE_MS = 5_000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const ERROR_BACKOFF_MS = 30_000;

const IMAGE_HOSTS = new Set([
    "i.scdn.co", "mosaic.scdn.co", "static-cdn.jtvnw.net", "cdn.akamai.steamstatic.com",
    "shared.akamai.steamstatic.com", "i.ytimg.com", "i9.ytimg.com", "pbs.twimg.com"
]);

export class ExpandedError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : Object.create(null);
}

function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finite(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value) {
    const number = finite(value);
    return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeCount(value) {
    if (typeof value === "string" && /^[0-9]+$/.test(value) && value.length < 16) return Number(value);
    return count(value);
}

function boundedText(value, maximum) {
    const valueText = text(value);
    return valueText.length > maximum ? `${valueText.slice(0, maximum - 1)}…` : valueText;
}

function componentText(value) {
    if (typeof value === "string") return boundedText(value, 500);
    const raw = record(value);
    const chunks = [];
    if (text(raw.text)) chunks.push(text(raw.text));
    if (Array.isArray(raw.extra)) {
        for (const part of raw.extra) {
            const item = componentText(part);
            if (item) chunks.push(item);
        }
    }
    return boundedText(chunks.join(""), 500);
}

function required(value, message) {
    if (!value) throw new ExpandedError(412, message);
    return value;
}

function cardKey(card) {
    return `${card.provider}:${card.kind}:${card.reference}`;
}

function validProfileId(value) {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function safeUrl(value) {
    if (typeof value !== "string") return undefined;
    try {
        const url = new URL(value);
        if (!(["https:", "http:"].includes(url.protocol)) || !url.hostname || url.username || url.password || url.port) return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function publicUrl(value) {
    return safeUrl(value);
}

function imageUrl(value) {
    const url = safeUrl(value);
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && IMAGE_HOSTS.has(parsed.hostname) ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function timestamp(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
    return value;
}

function field(label, value) {
    return typeof value === "string" && value ? { label, value } : null;
}

function fields(...items) {
    return items.filter(Boolean);
}

function summary({ title, subtitle, description, status, statusLabel, fields: detail = [], url, imageUrl: artwork, startedAt, endsAt, copyText }) {
    return {
        title: text(title, "Unavailable"),
        ...(text(subtitle) ? { subtitle: text(subtitle) } : {}),
        ...(text(description) ? { description: text(description) } : {}),
        status,
        statusLabel: text(statusLabel, "Unknown"),
        fields: Array.isArray(detail) ? detail.slice(0, 8) : [],
        ...(publicUrl(url) ? { url: publicUrl(url) } : {}),
        ...(imageUrl(artwork) ? { imageUrl: imageUrl(artwork) } : {}),
        ...(timestamp(startedAt) ? { startedAt: timestamp(startedAt) } : {}),
        ...(timestamp(endsAt) ? { endsAt: timestamp(endsAt) } : {}),
        ...(text(copyText) ? { copyText: text(copyText) } : {})
    };
}

function profileFor(options, provider, reference) {
    if (!validProfileId(reference)) throw new ExpandedError(400, "Invalid saved profile");
    const profile = options.getProfile(reference);
    if (!profile || profile.provider !== provider) throw new ExpandedError(404, "Saved profile is unavailable");
    return profile;
}

function origin(baseUrl, localOnly = false) {
    try {
        const url = new URL(baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
        if (localOnly && url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
        return url;
    } catch {
        throw new ExpandedError(412, "This saved connection needs a valid address");
    }
}

function endpoint(baseUrl, pathname, params) {
    const url = origin(baseUrl);
    url.pathname = pathname;
    url.search = "";
    if (params) for (const [name, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    return url.toString();
}

function statusError(provider, status) {
    if (status === 401 || status === 403) return new ExpandedError(412, `${provider} credentials need attention`);
    if (status === 404) return new ExpandedError(404, `${provider} item was not found`);
    if (status === 429) return new ExpandedError(429, `${provider} rate limit reached; try again later`);
    return new ExpandedError(502, `${provider} is temporarily unavailable`);
}

function integration(options, provider) {
    const value = options.getIntegration(provider);
    if (!value || value.provider !== provider) throw new ExpandedError(412, `${provider} is not configured`);
    return value;
}

function credential(value, name, provider) {
    const result = record(value.secret)[name];
    return required(typeof result === "string" && result ? result : "", `${provider} needs credentials in Connections`);
}

function configValue(value, name, provider) {
    const result = record(value.config)[name];
    return required(typeof result === "string" && result ? result : "", `${provider} needs setup in Connections`);
}

function validSpotifyId(reference) {
    if (!/^[A-Za-z0-9]{22}$/.test(reference)) throw new ExpandedError(400, "Spotify ID must be 22 characters");
}

function validLogin(reference) {
    if (!/^[A-Za-z0-9_]{1,25}$/.test(reference)) throw new ExpandedError(400, "Invalid Twitch channel");
}

function validPositiveId(reference, name) {
    if (!/^[1-9][0-9]*$/.test(reference) || reference.length > 20) throw new ExpandedError(400, `Invalid ${name} ID`);
}

function validYoutubeId(reference) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(reference)) throw new ExpandedError(400, "Invalid YouTube video ID");
}

/**
 * Resolves native-backed cards. Network and secret-bearing operations stay in
 * the caller supplied bridge transport; this module only returns public card data.
 */
export function createExpandedResolver(input = {}) {
    const options = {
        getProfile: input.getProfile ?? (() => null),
        getIntegration: input.getIntegration ?? (() => null),
        getRevision: input.getRevision ?? (() => 0),
        consumeXRequest: input.consumeXRequest,
        requestJson: input.requestJson,
        minecraftStatus: input.minecraftStatus,
        now: input.now ?? Date.now
    };
    if (typeof options.requestJson !== "function") throw new Error("requestJson is required");

    const cache = new Map();
    const pending = new Map();
    const controllers = new Set();
    const tokens = new Map();
    let revision = options.getRevision();
    let generation = 0;
    let closed = false;

    function invalidateInternal() {
        generation++;
        cache.clear();
        pending.clear();
        tokens.clear();
        for (const controller of controllers) controller.abort();
        controllers.clear();
    }

    function syncRevision() {
        const next = options.getRevision();
        if (next !== revision) {
            revision = next;
            invalidateInternal();
        }
    }

    function ensureCurrent(workRevision, workGeneration) {
        if (closed) throw new ExpandedError(503, "Bridge is closed");
        if (options.getRevision() !== workRevision || generation !== workGeneration) {
            syncRevision();
            throw new ExpandedError(409, "Connection settings changed; try again");
        }
    }

    async function requestJson(url, request, workRevision, workGeneration) {
        const controller = new AbortController();
        controllers.add(controller);
        try {
            const response = await options.requestJson(url, { ...request, signal: controller.signal });
            ensureCurrent(workRevision, workGeneration);
            if (!response || !Number.isInteger(response.status)) throw new ExpandedError(502, "Provider returned an invalid response");
            return { status: response.status, data: response.data, headers: response.headers instanceof Headers ? response.headers : new Headers() };
        } catch (error) {
            if (error instanceof ExpandedError) throw error;
            if (controller.signal.aborted) throw new ExpandedError(409, "Connection settings changed; try again");
            throw new ExpandedError(502, "Provider is temporarily unavailable");
        } finally {
            controllers.delete(controller);
        }
    }

    async function spotifyToken(workRevision, workGeneration) {
        const now = options.now();
        const cached = tokens.get("spotify");
        if (cached && cached.expiresAt > now) return cached.value;
        const profile = integration(options, "spotify");
        const clientId = configValue(profile, "clientId", "Spotify");
        const clientSecret = credential(profile, "clientSecret", "Spotify");
        const response = await requestJson("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials"
        }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Spotify", response.status);
        const raw = record(response.data);
        const value = text(raw.access_token);
        if (!value) throw new ExpandedError(502, "Spotify returned an invalid token response");
        tokens.set("spotify", { value, expiresAt: now + Math.max(60, finite(raw.expires_in) ?? 3_600) * 1_000 - 30_000 });
        return value;
    }

    async function twitchToken(workRevision, workGeneration) {
        const now = options.now();
        const cached = tokens.get("twitch");
        if (cached && cached.expiresAt > now) return cached;
        const profile = integration(options, "twitch");
        const clientId = configValue(profile, "clientId", "Twitch");
        const clientSecret = credential(profile, "clientSecret", "Twitch");
        const response = await requestJson("https://id.twitch.tv/oauth2/token", {
            method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString()
        }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Twitch", response.status);
        const raw = record(response.data);
        const value = text(raw.access_token);
        if (!value) throw new ExpandedError(502, "Twitch returned an invalid token response");
        tokens.set("twitch", { value, expiresAt: now + Math.max(60, finite(raw.expires_in) ?? 3_600) * 1_000 - 30_000, clientId });
        return tokens.get("twitch");
    }

    async function fivem(card, workRevision, workGeneration) {
        const profile = profileFor(options, "fivem", card.reference);
        const config = record(profile.config);
        const baseUrl = configValue(profile, "baseUrl", "FiveM");
        const [dynamic, info] = await Promise.all([
            requestJson(endpoint(baseUrl, "/dynamic.json"), { localOnly: false }, workRevision, workGeneration),
            requestJson(endpoint(baseUrl, "/info.json"), { localOnly: false }, workRevision, workGeneration).catch(() => null)
        ]);
        if (dynamic.status < 200 || dynamic.status >= 300) throw statusError("FiveM", dynamic.status);
        const dynamicData = record(dynamic.data);
        const hostname = text(dynamicData.hostname);
        if (!hostname) throw new ExpandedError(502, "FiveM returned an invalid server response");
        const infoData = info && info.status >= 200 && info.status < 300 ? record(info.data) : Object.create(null);
        const vars = record(infoData.vars);
        const players = count(dynamicData.clients ?? dynamicData.players);
        const maximum = count(dynamicData.sv_maxclients ?? vars.sv_maxClients);
        return summary({
            title: hostname,
            description: text(vars.sv_projectDesc), status: "online", statusLabel: "Online",
            fields: fields(field("Players", players !== null && maximum !== null ? `${players} / ${maximum}` : players !== null ? String(players) : "Unknown")),
            url: text(config.joinUrl), startedAt: undefined
        });
    }

    async function minecraft(card, workRevision, workGeneration) {
        const profile = profileFor(options, "minecraft", card.reference);
        const config = record(profile.config);
        const host = configValue(profile, "host", "Minecraft");
        const port = count(config.port);
        if (!port || port > 65535) throw new ExpandedError(412, "Minecraft needs a valid port");
        const controller = new AbortController();
        controllers.add(controller);
        let data;
        try {
            if (typeof options.minecraftStatus !== "function") throw new ExpandedError(502, "Minecraft is temporarily unavailable");
            data = await options.minecraftStatus({ host, port }, { signal: controller.signal });
            ensureCurrent(workRevision, workGeneration);
        } catch (error) {
            if (error instanceof ExpandedError) throw error;
            if (controller.signal.aborted) throw new ExpandedError(409, "Connection settings changed; try again");
            throw new ExpandedError(502, "Minecraft is temporarily unavailable");
        } finally {
            controllers.delete(controller);
        }
        const raw = record(data);
        const players = record(raw.players);
        const online = count(players.online);
        const maximum = count(players.max);
        return summary({
            title: profile.name, subtitle: text(record(raw.version).name, text(raw.version)), description: componentText(raw.description), status: "online", statusLabel: "Online",
            fields: fields(field("Players", online !== null && maximum !== null ? `${online} / ${maximum}` : "Unknown")), copyText: `${host}:${port}`
        });
    }

    async function dockhand(card, workRevision, workGeneration) {
        const profile = profileFor(options, "dockhand", card.reference);
        const config = record(profile.config);
        const baseUrl = configValue(profile, "baseUrl", "Dockhand");
        const environmentId = count(config.environmentId);
        if (!environmentId) throw new ExpandedError(412, "Dockhand needs an environment");
        const selected = Array.isArray(config.containerNames) ? config.containerNames.filter(name => typeof name === "string" && name.trim()).slice(0, 50) : [];
        if (!selected.length) throw new ExpandedError(412, "Dockhand needs selected containers");
        const session = text(record(profile.secret).session);
        const response = await requestJson(endpoint(baseUrl, "/api/containers", { env: environmentId, all: true }), {
            headers: session ? { cookie: `dockhand_session=${session}` } : {}, localOnly: true
        }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Dockhand", response.status);
        const rows = Array.isArray(response.data) ? response.data.map(record) : [];
        const wanted = new Set(selected);
        const containers = rows.filter(row => wanted.has(text(row.name)));
        if (!containers.length) return summary({ title: profile.name, status: "unknown", statusLabel: "No selected containers found", fields: [] });
        let pendingUpdates = null;
        try {
            const updates = await requestJson(endpoint(baseUrl, "/api/containers/pending-updates", { env: environmentId }), {
                headers: session ? { cookie: `dockhand_session=${session}` } : {}, localOnly: true
            }, workRevision, workGeneration);
            if (updates.status >= 200 && updates.status < 300 && Array.isArray(updates.data?.pendingUpdates)) pendingUpdates = updates.data.pendingUpdates.map(record);
        } catch { /* Optional update metadata must not hide container status. */ }
        const details = selected.map(name => {
            const row = containers.find(item => text(item.name) === name);
            const update = row && pendingUpdates?.find(item => text(row.id) && item.containerId === row.id);
            const createdMs = count(row?.created) !== null ? row.created * 1000 : NaN;
            const createdAt = Number.isFinite(createdMs) && createdMs > 0 && createdMs <= 8640000000000000 ? new Date(createdMs).toISOString() : undefined;
            return {
                name: boundedText(name, 200), state: boundedText(row?.state, 80) || "unavailable",
                status: boundedText(row?.status, 200) || "Selected container unavailable",
                image: boundedText(row?.image, 300),
                updateStatus: !row || pendingUpdates === null ? "unknown" : update ? "available" : "none-reported",
                ...(createdAt ? { createdAt } : {}),
                ...(timestamp(update?.checkedAt) ? { updateCheckedAt: timestamp(update.checkedAt) } : {})
            };
        });
        const running = containers.filter(row => text(row.state).toLowerCase() === "running").length;
        const healthy = containers.filter(row => /\bhealthy\b/i.test(text(row.status))).length;
        const unhealthy = containers.some(row => /\bunhealthy\b/i.test(text(row.status)));
        const missing = selected.length - containers.length;
        const status = missing ? "unknown" : unhealthy ? "degraded" : running === containers.length ? healthy === containers.length ? "healthy" : "online" : running ? "degraded" : "outage";
        return { ...summary({
            title: profile.name, status, statusLabel: status === "unknown" ? "Selected containers unavailable" : unhealthy ? "Health check failing" : status === "healthy" ? "Healthy" : status === "online" ? "Running" : status === "degraded" ? "Partially running" : "Stopped",
            fields: fields(field("Running", `${running} / ${selected.length}`), healthy ? field("Healthy", `${healthy} / ${selected.length}`) : null)
        }), containers: details };
    }

    async function statuspage(card, workRevision, workGeneration) {
        const profile = profileFor(options, "statuspage", card.reference);
        const response = await requestJson(endpoint(configValue(profile, "baseUrl", "Status page"), "/api/v2/summary.json"), {}, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Status page", response.status);
        const raw = record(response.data);
        const state = record(raw.status);
        const indicator = text(state.indicator).toLowerCase();
        const status = indicator === "none" ? "healthy" : ["minor", "maintenance"].includes(indicator) ? "degraded" : ["major", "critical"].includes(indicator) ? "outage" : "unknown";
        const incidents = Array.isArray(raw.incidents) ? raw.incidents : [];
        const incidentSummary = incidents.slice(0, 3).map(item => text(record(item).name)).filter(Boolean).join("\n");
        return summary({ title: text(record(raw.page).name, profile.name), description: [text(state.description), incidentSummary].filter(Boolean).join("\n"), status, statusLabel: text(state.description, "Unknown"), fields: fields(incidents.length ? field("Incidents", String(incidents.length)) : null) });
    }

    async function spotify(card, workRevision, workGeneration) {
        validSpotifyId(card.reference);
        const token = await spotifyToken(workRevision, workGeneration);
        const response = await requestJson(`https://api.spotify.com/v1/${card.kind === "track" ? "tracks" : "playlists"}/${encodeURIComponent(card.reference)}`, { headers: { authorization: `Bearer ${token}` } }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Spotify", response.status);
        const raw = record(response.data);
        const images = card.kind === "track" ? record(raw.album).images : raw.images;
        const art = Array.isArray(images) ? record(images[0]).url : undefined;
        if (card.kind === "track") {
            if (!text(raw.name) || !Array.isArray(raw.artists)) throw new ExpandedError(502, "Spotify returned an invalid track response");
            const artists = Array.isArray(raw.artists) ? raw.artists.map(artist => text(record(artist).name)).filter(Boolean).join(", ") : "";
            return summary({ title: raw.name, subtitle: artists, description: text(record(raw.album).name), status: "info", statusLabel: "Track", fields: [], url: `https://open.spotify.com/track/${card.reference}`, imageUrl: art });
        }
        if (!text(raw.name)) throw new ExpandedError(502, "Spotify returned an invalid playlist response");
        const total = count(record(raw.items).total ?? record(raw.tracks).total);
        return summary({ title: raw.name, subtitle: text(record(raw.owner).display_name), description: text(raw.description), status: "info", statusLabel: "Playlist", fields: fields(total !== null ? field("Tracks", String(total)) : null), url: `https://open.spotify.com/playlist/${card.reference}`, imageUrl: art });
    }

    async function twitch(card, workRevision, workGeneration) {
        validLogin(card.reference);
        const auth = await twitchToken(workRevision, workGeneration);
        const response = await requestJson(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(card.reference)}`, { headers: { authorization: `Bearer ${auth.value}`, "client-id": auth.clientId } }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("Twitch", response.status);
        const streamData = record(response.data).data;
        if (!Array.isArray(streamData)) throw new ExpandedError(502, "Twitch returned an invalid stream response");
        if (!streamData.length) return summary({ title: card.reference, status: "offline", statusLabel: "Offline", fields: [], url: `https://www.twitch.tv/${encodeURIComponent(card.reference)}` });
        const stream = record(streamData[0]);
        if (!text(stream.user_name)) throw new ExpandedError(502, "Twitch returned an invalid stream response");
        return summary({
            title: text(stream.user_name, card.reference), subtitle: text(stream.game_name), description: text(stream.title), status: "live", statusLabel: "Live",
            fields: fields(field("Viewers", count(stream.viewer_count) !== null ? String(count(stream.viewer_count)) : "Unknown")), url: `https://www.twitch.tv/${encodeURIComponent(card.reference)}`,
            imageUrl: text(stream.thumbnail_url).replace("{width}", "640").replace("{height}", "360"), startedAt: stream.started_at
        });
    }

    async function steam(card, workRevision, workGeneration) {
        validPositiveId(card.reference, "Steam app");
        const profile = options.getIntegration("steam");
        const country = /^[a-z]{2}$/i.test(text(record(profile?.config).country)) ? text(record(profile?.config).country).toLowerCase() : "us";
        const [storeResult, playersResult] = await Promise.all([
            requestJson(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(card.reference)}&cc=${country}`, {}, workRevision, workGeneration),
            requestJson(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(card.reference)}`, {}, workRevision, workGeneration).catch(() => null)
        ]);
        if (storeResult.status < 200 || storeResult.status >= 300) throw statusError("Steam", storeResult.status);
        const item = record(record(storeResult.data)[card.reference]);
        const data = record(item.data);
        if (!item.success || !text(data.name)) throw new ExpandedError(404, "Steam game was not found");
        const price = record(data.price_overview);
        const priceText = data.is_free === true ? "Free to play" : text(price.final_formatted);
        const discount = count(price.discount_percent);
        const playerCount = playersResult && playersResult.status >= 200 && playersResult.status < 300 ? count(record(record(playersResult.data).response).player_count) : null;
        return summary({
            title: data.name, description: text(data.short_description), status: "info", statusLabel: "Steam",
            fields: fields(priceText ? field("Price", discount ? `${priceText} (${discount}% off)` : priceText) : null, playerCount !== null ? field("Playing now", String(playerCount)) : null),
            url: `https://store.steampowered.com/app/${card.reference}/`, imageUrl: data.header_image
        });
    }

    async function youtube(card, workRevision, workGeneration) {
        validYoutubeId(card.reference);
        const profile = integration(options, "youtube");
        const apiKey = credential(profile, "apiKey", "YouTube");
        const response = await requestJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(card.reference)}&key=${encodeURIComponent(apiKey)}`, {}, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("YouTube", response.status);
        const item = record(Array.isArray(record(response.data).items) ? record(response.data).items[0] : null);
        if (!Object.keys(item).length) throw new ExpandedError(404, "YouTube video was not found");
        const live = record(item.liveStreamingDetails);
        const snippet = record(item.snippet);
        const actualStart = timestamp(live.actualStartTime);
        const actualEnd = timestamp(live.actualEndTime);
        const scheduled = timestamp(live.scheduledStartTime);
        const status = actualEnd ? "ended" : actualStart ? "live" : scheduled ? "scheduled" : "info";
        return summary({
            title: text(snippet.title, "YouTube video"), subtitle: text(snippet.channelTitle), status, statusLabel: status === "live" ? "Live" : status === "scheduled" ? "Scheduled" : status === "ended" ? "Ended" : "Video",
            fields: fields(safeCount(live.concurrentViewers) !== null ? field("Watching", String(safeCount(live.concurrentViewers))) : null), url: `https://www.youtube.com/watch?v=${encodeURIComponent(card.reference)}`,
            imageUrl: record(record(snippet.thumbnails).high).url ?? record(record(snippet.thumbnails).medium).url, startedAt: actualStart ?? scheduled, endsAt: actualEnd
        });
    }

    async function xPost(card, workRevision, workGeneration, forceRefresh) {
        validPositiveId(card.reference, "X post");
        const profile = integration(options, "x");
        const config = record(profile.config);
        if (config.allowPaidReads !== true) throw new ExpandedError(412, "X paid reads are disabled in Connections");
        if (!forceRefresh) throw new ExpandedError(412, "X cards need a manual refresh before a paid read");
        const limit = count(config.maxRequestsPerHour);
        if (!limit) throw new ExpandedError(412, "X needs a request budget in Connections");
        const now = options.now();
        const token = credential(profile, "bearerToken", "X");
        if (typeof options.consumeXRequest !== "function") throw new ExpandedError(412, "Durable X request-budget storage is unavailable");
        if (!options.consumeXRequest(limit, now)) throw new ExpandedError(429, "X request budget reached; try again later");
        const response = await requestJson(`https://api.x.com/2/tweets/${encodeURIComponent(card.reference)}?tweet.fields=created_at,author_id,public_metrics,attachments,referenced_tweets&expansions=author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id&user.fields=name,username&media.fields=type,url,preview_image_url`, { headers: { authorization: `Bearer ${token}` } }, workRevision, workGeneration);
        if (response.status < 200 || response.status >= 300) throw statusError("X", response.status);
        const raw = record(response.data);
        const post = record(raw.data);
        if (!text(post.text)) throw new ExpandedError(404, "X post was not found");
        const author = record((Array.isArray(record(raw.includes).users) ? record(raw.includes).users : []).find(user => record(user).id === post.author_id));
        const name = text(author.name, "X post");
        const username = text(author.username);
        const metrics = record(post.public_metrics);
        const includedTweets = Array.isArray(record(raw.includes).tweets) ? record(raw.includes).tweets.map(record) : [];
        const quoteRef = (Array.isArray(post.referenced_tweets) ? post.referenced_tweets : []).find(item => record(item).type === "quoted");
        const quote = quoteRef ? includedTweets.find(item => item.id === quoteRef.id && text(item.text)) : undefined;
        const media = Array.isArray(record(raw.includes).media) ? record(raw.includes).media.map(record) : [];
        const mediaKeys = record(post.attachments).media_keys;
        const photo = media.find(item => item.type === "photo" && Array.isArray(mediaKeys) && mediaKeys.includes(item.media_key));
        return summary({ title: name, subtitle: username ? `@${username}` : "", description: post.text, status: "info", statusLabel: "Post", fields: fields(count(metrics.like_count) !== null ? field("Likes", String(count(metrics.like_count))) : null, quote ? field("Quoted", boundedText(quote.text, 240)) : null), url: `https://x.com/${encodeURIComponent(username || "i")}/status/${card.reference}`, imageUrl: photo?.url, startedAt: post.created_at });
    }

    const adapters = { fivem, minecraft, dockhand, statuspage, spotify, twitch, steam, youtube, x: xPost };

    async function resolve(card, forceRefresh = false) {
        if (closed) throw new ExpandedError(503, "Bridge is closed");
        if (!card || !isBridgeBacked(card.provider, card.kind) || typeof card.reference !== "string") throw new ExpandedError(404, "Unknown card provider or kind");
        syncRevision();
        const key = cardKey(card);
        const now = options.now();
        const existing = cache.get(key);
        if (existing?.backoffUntil > now) {
            if (existing.data) return envelope(existing, { stale: true, warning: existing.backoffMessage });
            throw new ExpandedError(existing.backoffStatus, existing.backoffMessage);
        }
        if (pending.has(key)) return pending.get(key);
        if (existing && !forceRefresh && existing.expiresAt > now) return envelope(existing);
        if (forceRefresh && Number.isFinite(existing?.lastManualAt) && now - existing.lastManualAt < MANUAL_GATE_MS) return envelope(existing, { refreshDeferredMs: MANUAL_GATE_MS - (now - existing.lastManualAt) });

        const workRevision = revision;
        const workGeneration = generation;
        const work = (async () => {
            const lastManualAt = forceRefresh ? now : existing?.lastManualAt;
            try {
                const data = await adapters[card.provider](card, workRevision, workGeneration, forceRefresh);
                ensureCurrent(workRevision, workGeneration);
                const ttl = bridgeTtlMs(card.provider, card.kind);
                const entry = { key, provider: card.provider, kind: card.kind, data, fetchedAt: options.now(), refreshAfterMs: ttl, expiresAt: options.now() + ttl, lastManualAt };
                cache.set(key, entry);
                return envelope(entry);
            } catch (error) {
                const safe = error instanceof ExpandedError ? error : new ExpandedError(502, "Provider is temporarily unavailable");
                if (safe.status === 409 || safe.status === 503 || safe.status === 412 || safe.status === 400 || safe.status === 404) throw safe;
                const entry = existing ?? { key, provider: card.provider, kind: card.kind, data: null, fetchedAt: 0, refreshAfterMs: 0 };
                entry.lastManualAt = lastManualAt;
                entry.backoffUntil = options.now() + (safe.status === 429 ? RATE_LIMIT_BACKOFF_MS : ERROR_BACKOFF_MS);
                entry.backoffStatus = safe.status;
                entry.backoffMessage = safe.message;
                cache.set(key, entry);
                if (entry.data) return envelope(entry, { stale: true, warning: safe.message });
                throw safe;
            } finally {
                if (pending.get(key) === work) pending.delete(key);
            }
        })();
        pending.set(key, work);
        return work;
    }

    return {
        supports(provider, kind) { return isBridgeBacked(provider, kind); },
        resolve,
        invalidate() { revision = options.getRevision(); invalidateInternal(); },
        close() { closed = true; invalidateInternal(); }
    };
}

function envelope(entry, extra = {}) {
    return {
        version: 1,
        key: entry.key,
        provider: entry.provider,
        kind: entry.kind,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        refreshAfterMs: entry.refreshAfterMs,
        data: entry.data,
        ...extra
    };
}

export const expandedArtworkHosts = [...IMAGE_HOSTS];
