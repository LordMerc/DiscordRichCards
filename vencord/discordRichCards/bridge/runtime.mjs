import http from "node:http";
import { safeRobloxImageUrl } from "./robloxImages.mjs";
import { currentRobloxEvents, normalizeRobloxEvents } from "./robloxEvents.mjs";
import { createExpandedResolver, ExpandedError } from "./expanded.mjs";
import { resolveCached } from "./cardCache.mjs";
import { requestJson as providerRequestJson } from "./transport.mjs";
import { minecraftStatus } from "./minecraft.mjs";
import fs from "node:fs";
import path from "node:path";

const MAX_BODY = 1024 * 1024;
const MIN_AUTOMATIC_UPSTREAM_INTERVAL_MS = 15_000;
const MIN_MANUAL_UPSTREAM_INTERVAL_MS = 5_000;
const OPEN_PULL_TTL_MS = 30_000;
const CLOSED_PULL_TTL_MS = 120_000;
const ROBLOX_GAME_TTL_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function configFrom(options = {}) {
    const env = options.env ?? process.env;
    return {
        host: options.host ?? env.RICHCARDS_HOST ?? env.HERMES_LIVE_HOST ?? "127.0.0.1",
        port: Number(options.port ?? env.RICHCARDS_PORT ?? env.HERMES_LIVE_PORT ?? 8787),
        token: options.token ?? env.RICHCARDS_TOKEN ?? env.HERMES_LIVE_TOKEN ?? "",
        dataFile: options.dataFile ?? env.RICHCARDS_DATA ?? env.HERMES_LIVE_DATA ?? path.join(process.cwd(), "hermes-live-data.json"),
        githubToken: options.githubToken ?? env.RICHCARDS_GITHUB_TOKEN ?? "",
        fetch: options.fetch ?? globalThis.fetch,
        now: options.now ?? Date.now,
        providerOptions: options.providerOptions ?? Object.create(null)
    };
}

function isLoopbackHost(host) {
    const normalized = String(host).toLowerCase();
    return normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || normalized.startsWith("127.");
}

function createEmptyDb() {
    return { sessions: Object.create(null), actions: Object.create(null), cards: Object.create(null), nextActionId: 1 };
}

function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : Object.create(null);
}

function storedRecord(value, name) {
    if (value === undefined) return Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name} in bridge data`);
    return value;
}

function loadDb(dataFile) {
    try {
        const loaded = JSON.parse(fs.readFileSync(dataFile, "utf8"));
        if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error("Invalid bridge data root");
        return {
            sessions: storedRecord(loaded.sessions, "sessions"),
            actions: storedRecord(loaded.actions, "actions"),
            cards: storedRecord(loaded.cards, "cards"),
            nextActionId: Number.isSafeInteger(loaded.nextActionId) && loaded.nextActionId > 0 ? loaded.nextActionId : 1
        };
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return createEmptyDb();
        throw new Error("Unable to load bridge data; refusing to overwrite the existing file", { cause: error });
    }
}

function safeId(value) {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store"
    });
    res.end(body);
}

function authorised(req, token) {
    return !token || req.headers.authorization === `Bearer ${token}`;
}

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new HttpError(400, "Request body exceeds 1 MiB");
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        return body;
    } catch {
        throw new HttpError(400, "Request body must be a JSON object");
    }
}

function normaliseState(sessionId, input, existing = {}) {
    const now = new Date().toISOString();
    const next = {
        version: 1,
        sessionId,
        title: input.title ?? existing.title ?? "Hermes session",
        status: input.status ?? existing.status ?? "queued",
        agent: input.agent ?? existing.agent,
        model: input.model ?? existing.model,
        current: input.current ?? existing.current,
        progress: input.progress ?? existing.progress ?? null,
        startedAt: input.startedAt ?? existing.startedAt ?? now,
        updatedAt: now,
        finishedAt: input.finishedAt ?? existing.finishedAt,
        activity: input.activity ?? existing.activity ?? [],
        metrics: { ...asRecord(existing.metrics), ...asRecord(input.metrics) },
        actions: input.actions ?? existing.actions ?? ["pause", "resume", "cancel"]
    };
    if (["success", "error", "cancelled"].includes(next.status) && !next.finishedAt) next.finishedAt = now;
    if (!["success", "error", "cancelled"].includes(next.status)) next.finishedAt = undefined;
    if (typeof next.progress === "number") next.progress = Math.max(0, Math.min(100, next.progress));
    return next;
}

function sessionRoute(pathname) {
    const match = /^\/api\/sessions\/([^/]+)(?:\/(actions))?$/.exec(pathname);
    if (!match) return null;
    let sessionId;
    try {
        sessionId = decodeURIComponent(match[1]);
    } catch {
        throw new HttpError(400, "Invalid session id");
    }
    if (!safeId(sessionId)) throw new HttpError(400, "Invalid session id");
    return { sessionId, suffix: match[2] || "" };
}

function cardRoute(pathname) {
    const match = /^\/api\/cards\/([a-z][a-z0-9-]{0,31})\/([a-z][a-z0-9-]{0,31})\/([^/]+)$/.exec(pathname);
    if (!match) return null;
    let reference;
    try {
        reference = decodeURIComponent(match[3]);
    } catch {
        throw new HttpError(400, "Invalid card reference");
    }
    if (!reference || reference.length > 256 || reference.includes("\0")) throw new HttpError(400, "Invalid card reference");
    return { provider: match[1], kind: match[2], reference };
}

function parsePullReference(reference) {
    const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]*)$/.exec(reference);
    if (!match) throw new HttpError(400, "GitHub pull request reference must be OWNER/REPO#NUMBER");
    const number = Number(match[3]);
    if (match[2] === "." || match[2] === ".." || !Number.isSafeInteger(number)) {
        throw new HttpError(400, "GitHub pull request reference must be OWNER/REPO#NUMBER");
    }
    return { owner: match[1], repo: match[2], number };
}

function normalizePull(raw, identity) {
    const pull = asRecord(raw);
    if (typeof pull.title !== "string" || typeof pull.html_url !== "string") throw new HttpError(502, "GitHub returned an invalid pull request response");
    const base = asRecord(pull.base);
    const head = asRecord(pull.head);
    const user = asRecord(pull.user);
    const labels = Array.isArray(pull.labels) ? pull.labels.map(item => asRecord(item).name).filter(name => typeof name === "string") : [];
    return {
        owner: identity.owner,
        repo: identity.repo,
        number: typeof pull.number === "number" ? pull.number : identity.number,
        title: pull.title,
        state: pull.merged_at ? "merged" : pull.state === "closed" ? "closed" : "open",
        draft: Boolean(pull.draft),
        author: typeof user.login === "string" ? user.login : "unknown",
        base: typeof base.ref === "string" ? base.ref : "",
        head: typeof head.ref === "string" ? head.ref : "",
        labels,
        changedFiles: Number.isFinite(pull.changed_files) ? pull.changed_files : 0,
        additions: Number.isFinite(pull.additions) ? pull.additions : 0,
        deletions: Number.isFinite(pull.deletions) ? pull.deletions : 0,
        comments: Number.isFinite(pull.comments) ? pull.comments : 0,
        createdAt: typeof pull.created_at === "string" ? pull.created_at : "",
        updatedAt: typeof pull.updated_at === "string" ? pull.updated_at : "",
        url: pull.html_url
    };
}

function cardEnvelope(entry, extra = {}) {
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

function githubError(response) {
    if (response.status === 404) return new HttpError(404, "GitHub pull request was not found");
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        return new HttpError(429, "GitHub rate limit reached; try again later");
    }
    return new HttpError(502, "GitHub could not provide this pull request");
}

function parseRobloxPlaceReference(reference) {
    if (!/^[1-9][0-9]*$/.test(reference)) throw new HttpError(400, "Roblox game reference must be a positive place ID");
    const placeId = Number(reference);
    if (!Number.isSafeInteger(placeId)) throw new HttpError(400, "Roblox game reference must be a positive place ID");
    return placeId;
}

function positiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeNumberOrNull(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function robloxError(response, resource) {
    if (response.status === 404 && resource === "place") return new HttpError(404, "Roblox game was not found");
    if (response.status === 429) return new HttpError(429, "Roblox rate limit reached; try again later");
    return new HttpError(502, "Roblox could not provide this game");
}

function normalizeRobloxDetails(raw, universeId) {
    const data = Array.isArray(asRecord(raw).data) ? raw.data : [];
    const game = asRecord(data[0]);
    if (positiveSafeInteger(game.id) !== universeId) throw new HttpError(502, "Roblox returned an invalid game response");
    return {
        name: typeof game.name === "string" && game.name.trim() ? game.name.trim() : "",
        creator: typeof asRecord(game.creator).name === "string" ? asRecord(game.creator).name : "",
        playing: nonNegativeNumberOrNull(game.playing),
        favorites: nonNegativeNumberOrNull(game.favoritedCount),
        visits: nonNegativeNumberOrNull(game.visits),
        updatedAt: typeof game.updated === "string" ? game.updated : ""
    };
}

function normalizeRobloxUniverse(raw, universeId) {
    const universe = asRecord(raw);
    if (positiveSafeInteger(universe.id) !== universeId) throw new HttpError(502, "Roblox returned invalid availability data");
    const privacyType = typeof universe.privacyType === "string" ? universe.privacyType : "";
    const active = typeof universe.isActive === "boolean" ? universe.isActive : null;
    const archived = typeof universe.isArchived === "boolean" ? universe.isArchived : null;
    let status = "unknown";
    let statusReason = "Roblox availability could not be confirmed";
    if (privacyType === "Private") {
        status = "private";
        statusReason = "This experience is private";
    } else if (archived === true || active === false) {
        status = "locked";
        statusReason = archived ? "This experience is archived" : "This experience is inactive";
    } else if (privacyType === "Public" && active === true && archived === false) {
        status = "open";
        statusReason = "This experience is public and active";
    }
    return {
        name: typeof universe.name === "string" && universe.name.trim() ? universe.name.trim() : "",
        creator: typeof universe.creatorName === "string" ? universe.creatorName : "",
        updatedAt: typeof universe.updated === "string" ? universe.updated : "",
        status,
        statusReason
    };
}

function normalizeCodexStatus(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.state !== "string") {
        throw new HttpError(502, "Codex tracker returned an invalid response");
    }
    const summary = asRecord(raw.automationSummary);
    const latest = summary.latest && typeof summary.latest === "object" ? asRecord(summary.latest) : summary;
    const text = value => typeof value === "string" ? value.slice(0, 2000) : "";
    const timestamp = value => {
        if (typeof value !== "number" && typeof value !== "string") return null;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null;
    };
    let tweetUrl = null;
    try {
        const url = new URL(latest.tweetUrl);
        if (url.protocol === "https:" && ["x.com", "twitter.com"].includes(url.hostname)
            && !url.username && !url.password && !url.port && /^\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]*$/.test(url.pathname)) {
            tweetUrl = url.origin + url.pathname;
        }
    } catch { /* A source link is optional. */ }
    return {
        state: ["yes", "no"].includes(raw.state) ? raw.state : "unknown",
        monitor: ["active", "inactive"].includes(summary.mode) ? summary.mode : "unknown",
        checkedAt: timestamp(latest.checkedAt),
        resetAt: timestamp(raw.resetAt) ?? timestamp(asRecord(summary.lastReset).checkedAt),
        tweetText: text(latest.tweetText), tweetUrl, rationale: text(latest.rationale)
    };
}

export function createBridge(options = {}) {
    const config = configFrom(options);
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("Invalid bridge port");
    if (typeof config.fetch !== "function") throw new Error("A fetch implementation is required");
    if (!config.token && (config.githubToken || !isLoopbackHost(config.host))) {
        throw new Error("RICHCARDS_TOKEN must be set for a non-loopback bridge or when RICHCARDS_GITHUB_TOKEN is configured");
    }
    const db = loadDb(config.dataFile);
    const pending = new Map();
    const expanded = createExpandedResolver({
        getProfile: () => null,
        getIntegration: () => null,
        getRevision: () => 0,
        requestJson: providerRequestJson,
        minecraftStatus,
        now: config.now,
        ...config.providerOptions
    });

    function saveDb() {
        fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
        const temp = `${config.dataFile}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(db, null, 2));
        fs.renameSync(temp, config.dataFile);
    }

    async function fetchGithubPull(url, headers) {
        const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
        let onAbort;
        const timeout = new Promise((_, reject) => {
            onAbort = () => reject(new HttpError(502, "GitHub request timed out"));
            signal.addEventListener("abort", onAbort, { once: true });
        });
        const request = (async () => {
            const response = await config.fetch(url, { headers, signal, redirect: "error" });
            if (response.status === 304) return { response };
            if (!response.ok) throw githubError(response);
            try {
                return { response, raw: await response.json() };
            } catch {
                throw new HttpError(502, "GitHub returned an invalid response");
            }
        })();
        try {
            return await Promise.race([request, timeout]);
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    function resolveUpstreamCard({ provider, kind, key, forceRefresh, unavailableMessage, envelope = cardEnvelope, fetchFresh }) {
        return resolveCached({
            key,
            provider,
            kind,
            existing: own(db.cards, key) ? db.cards[key] : null,
            forceRefresh,
            pending,
            now: config.now,
            envelope,
            createError: (status, message) => new HttpError(status, message),
            toSafeError: error => error instanceof HttpError ? error : new HttpError(502, unavailableMessage),
            store: entry => {
                db.cards[key] = entry;
                saveDb();
            },
            fetchFresh,
            manualIntervalMs: MIN_MANUAL_UPSTREAM_INTERVAL_MS,
            automaticIntervalMs: MIN_AUTOMATIC_UPSTREAM_INTERVAL_MS,
            unavailableMessage
        });
    }

    async function resolveGithubPull(reference, forceRefresh) {
        const identity = parsePullReference(reference);
        const key = `github:pr:${reference}`;
        return resolveUpstreamCard({
            provider: "github",
            kind: "pr",
            key,
            forceRefresh,
            unavailableMessage: "GitHub is temporarily unavailable",
            fetchFresh: async ({ existing }) => {
                const headers = {
                    accept: "application/vnd.github+json",
                    "user-agent": "Discord-RichCards-Bridge/1.0",
                    ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
                    ...(existing?.etag ? { "if-none-match": existing.etag } : {})
                };
                const { response, raw } = await fetchGithubPull(`https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/pulls/${identity.number}`, headers);
                if (response.status === 304 && existing) {
                    existing.fetchedAt = config.now();
                    existing.etag = response.headers.get("etag") ?? existing.etag;
                    delete existing.backoffUntil;
                    return existing;
                }
                const data = normalizePull(raw, identity);
                return {
                    key,
                    provider: "github",
                    kind: "pr",
                    data,
                    fetchedAt: config.now(),
                    refreshAfterMs: data.state === "open" ? OPEN_PULL_TTL_MS : CLOSED_PULL_TTL_MS,
                    etag: response.headers.get("etag") ?? undefined
                };
            }
        });
    }

    async function resolveCodexReset(reference, forceRefresh) {
        if (reference !== "today") throw new HttpError(400, "Invalid Codex reset reference");
        const key = `codex:reset:${reference}`;
        return resolveUpstreamCard({
            provider: "codex",
            kind: "reset",
            key,
            forceRefresh,
            unavailableMessage: "Codex tracker is temporarily unavailable",
            fetchFresh: async () => {
                const response = await config.fetch("https://hascodexratelimitreset.today/api/status", {
                    headers: { accept: "application/json", "user-agent": "Discord-RichCards-Bridge/1.0" },
                    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "error"
                });
                if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, "Codex tracker is temporarily unavailable");
                const data = normalizeCodexStatus(await response.json());
                return { key, provider: "codex", kind: "reset", data, fetchedAt: config.now(), refreshAfterMs: 30_000 };
            }
        });
    }

    async function fetchRobloxJson(url, signal, resource) {
        let response;
        try {
            response = await config.fetch(url, {
                headers: { accept: "application/json", "user-agent": "Discord-RichCards-Bridge/1.0" },
                signal,
                redirect: "error"
            });
        } catch {
            if (signal.aborted) throw new HttpError(502, "Roblox request timed out");
            throw new HttpError(502, "Roblox is temporarily unavailable");
        }
        if (!response.ok) throw robloxError(response, resource);
        try {
            return await response.json();
        } catch {
            if (signal.aborted) throw new HttpError(502, "Roblox request timed out");
            throw new HttpError(502, "Roblox returned an invalid response");
        }
    }

    async function fetchRobloxArtwork(universeId, parentSignal, existing) {
        if (existing?.artworkExpiresAt > config.now()) return {
            iconUrl: safeRobloxImageUrl(existing.data?.iconUrl),
            thumbnailUrl: safeRobloxImageUrl(existing.data?.thumbnailUrl),
            expiresAt: existing.artworkExpiresAt
        };
        // Optional artwork must not hold up live stats for more than two seconds.
        const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(2000)]);
        const [icons, thumbnails] = await Promise.allSettled([
            fetchRobloxJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`, signal, "artwork"),
            fetchRobloxJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`, signal, "artwork")
        ]);
        const icon = icons.status === "fulfilled" && Array.isArray(icons.value?.data) ? icons.value.data.find(item => item?.targetId === universeId) : null;
        const group = thumbnails.status === "fulfilled" && Array.isArray(thumbnails.value?.data) ? thumbnails.value.data.find(item => item?.universeId === universeId) : null;
        const thumbnail = Array.isArray(group?.thumbnails) ? group.thumbnails[0] : null;
        const iconUrl = icons.status === "rejected" ? safeRobloxImageUrl(existing?.data?.iconUrl) : icon?.state === "Completed" ? safeRobloxImageUrl(icon.imageUrl) : null;
        const thumbnailUrl = thumbnails.status === "rejected" ? safeRobloxImageUrl(existing?.data?.thumbnailUrl) : thumbnail?.state === "Completed" ? safeRobloxImageUrl(thumbnail.imageUrl) : null;
        const complete = icons.status === "fulfilled" && thumbnails.status === "fulfilled" && iconUrl && thumbnailUrl;
        return { iconUrl, thumbnailUrl, expiresAt: config.now() + (complete ? 300000 : 60000) };
    }

    async function fetchRobloxEvents(universeId, parentSignal, existing, forceRefresh) {
        const cached = {
            events: currentRobloxEvents(existing?.data?.events ?? [], config.now()),
            status: existing?.data?.eventsStatus ?? "unavailable",
            truncated: existing?.data?.eventsTruncated ?? false,
            expiresAt: existing?.eventsExpiresAt ?? 0,
            retryAt: existing?.eventsRetryAt ?? 0
        };
        if (cached.retryAt > config.now() || (!forceRefresh && cached.expiresAt > config.now())) return cached;
        const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(2000)]);
        try {
            const events = new Map();
            let cursor = "";
            // Bound pagination and share one timeout across all pages.
            for (let page = 0; page < 5; page++) {
                const raw = await fetchRobloxJson(`https://apis.roblox.com/virtual-events/v1/universes/${universeId}/virtual-events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, signal, "events");
                for (const event of normalizeRobloxEvents(raw, universeId)) events.set(event.id, event);
                cursor = raw.nextPageCursor || "";
                if (!cursor) break;
            }
            return { events: currentRobloxEvents([...events.values()], config.now()), status: "ready", truncated: !!cursor, expiresAt: config.now() + 300000, retryAt: 0 };
        } catch {
            return { ...cached, status: existing?.data?.eventsStatus && existing.data.eventsStatus !== "unavailable" ? "stale" : "unavailable", expiresAt: 0, retryAt: config.now() + 60000 };
        }
    }

    async function resolveRobloxGame(reference, forceRefresh) {
        const placeId = parseRobloxPlaceReference(reference);
        const key = `roblox:game:${placeId}`;
        const robloxEnvelope = (entry, extra = {}) => cardEnvelope(entry, {
            ...(entry.warning ? { warning: entry.warning } : {}),
            ...extra
        });
        return resolveUpstreamCard({
            provider: "roblox",
            kind: "game",
            key,
            forceRefresh,
            unavailableMessage: "Roblox is temporarily unavailable",
            envelope: robloxEnvelope,
            fetchFresh: async ({ existing }) => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
                try {
                    const cachedUniverseId = existing?.data?.placeId === placeId ? positiveSafeInteger(existing.data.universeId) : null;
                    const universeId = cachedUniverseId ?? positiveSafeInteger(asRecord(await fetchRobloxJson(
                        `https://apis.roblox.com/universes/v1/places/${placeId}/universe`, controller.signal, "place"
                    )).universeId);
                    if (!universeId) throw new HttpError(502, "Roblox returned an invalid game response");

                    const [detailsResult, universeResult, artworkResult, eventsResult] = await Promise.allSettled([
                        fetchRobloxJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`, controller.signal, "game").then(raw => normalizeRobloxDetails(raw, universeId)),
                        fetchRobloxJson(`https://develop.roblox.com/v1/universes/${universeId}`, controller.signal, "universe").then(raw => normalizeRobloxUniverse(raw, universeId)),
                        fetchRobloxArtwork(universeId, controller.signal, existing),
                        fetchRobloxEvents(universeId, controller.signal, existing, forceRefresh)
                    ]);
                    const artwork = artworkResult.status === "fulfilled" ? artworkResult.value : { iconUrl: null, thumbnailUrl: null, expiresAt: 0 };
                    const events = eventsResult.status === "fulfilled" ? eventsResult.value : { events: [], status: "unavailable", truncated: false, expiresAt: 0, retryAt: config.now() + 60000 };
                    const details = detailsResult.status === "fulfilled" ? detailsResult.value : null;
                    const universe = universeResult.status === "fulfilled" ? universeResult.value : null;
                    const rateLimited = [detailsResult, universeResult].find(result => result.status === "rejected" && result.reason instanceof HttpError && result.reason.status === 429);
                    if (rateLimited) throw rateLimited.reason;
                    if (!details && !universe) throw new HttpError(502, "Roblox is temporarily unavailable");

                    const warnings = [];
                    if (!details) warnings.push("Roblox game details are temporarily unavailable");
                    if (!universe || universe.status === "unknown") warnings.push("Roblox availability could not be confirmed");
                    const name = details?.name || universe?.name || "";
                    if (!name) throw new HttpError(502, "Roblox returned an invalid game response");
                    const data = {
                        placeId,
                        universeId,
                        name,
                        creator: details?.creator || universe?.creator || "Unknown",
                        playing: details?.playing ?? null,
                        favorites: details?.favorites ?? null,
                        visits: details?.visits ?? null,
                        status: universe?.status ?? "unknown",
                        statusReason: universe?.statusReason ?? "Roblox availability could not be confirmed",
                        updatedAt: details?.updatedAt || universe?.updatedAt || "",
                        iconUrl: artwork.iconUrl,
                        thumbnailUrl: artwork.thumbnailUrl,
                        events: events.events,
                        eventsStatus: events.status,
                        eventsTruncated: events.truncated
                    };
                    return {
                        key,
                        provider: "roblox",
                        kind: "game",
                        data,
                        fetchedAt: config.now(),
                        refreshAfterMs: ROBLOX_GAME_TTL_MS,
                        artworkExpiresAt: artwork.expiresAt,
                        eventsExpiresAt: events.expiresAt,
                        eventsRetryAt: events.retryAt,
                        warning: warnings.length ? warnings.join("; ") : undefined
                    };
                } finally {
                    clearTimeout(timeout);
                }
            }
        });
    }

    const cardHandlers = new Map([
        ["hermes:session", async card => {
            if (!safeId(card.reference)) throw new HttpError(400, "Invalid session id");
            if (!own(db.sessions, card.reference)) throw new HttpError(404, `Unknown session: ${card.reference}`);
            const state = db.sessions[card.reference];
            return cardEnvelope({ key: `hermes:session:${card.reference}`, provider: "hermes", kind: "session", fetchedAt: Date.parse(state.updatedAt) || config.now(), refreshAfterMs: 1_000, data: state });
        }],
        ["github:pr", async (card, forceRefresh) => resolveGithubPull(card.reference, forceRefresh)],
        ["roblox:game", async (card, forceRefresh) => resolveRobloxGame(card.reference, forceRefresh)],
        ["codex:reset", async (card, forceRefresh) => resolveCodexReset(card.reference, forceRefresh)]
    ]);

    async function handler(req, res) {
        try {
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            if (typeof req.headers.origin === "string" || typeof req.headers["sec-fetch-site"] === "string") {
                throw new HttpError(403, "Browser-origin requests are not allowed");
            }
            if (req.method === "OPTIONS") {
                res.writeHead(204);
                res.end();
                return;
            }
            if (url.pathname === "/health") {
                json(res, 200, { ok: true, service: "discord-richcards-bridge", sessions: Object.keys(db.sessions).length });
                return;
            }
            if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "Not found");
            if (!authorised(req, config.token)) throw new HttpError(401, "Unauthorized");

            if (url.pathname === "/api/sessions" && req.method === "GET") return json(res, 200, Object.values(db.sessions));
            const session = sessionRoute(url.pathname);
            if (session) {
                const { sessionId, suffix } = session;
                if (!suffix && req.method === "GET") {
                    if (!own(db.sessions, sessionId)) throw new HttpError(404, `Unknown session: ${sessionId}`);
                    return json(res, 200, db.sessions[sessionId]);
                }
                if (!suffix && (req.method === "PUT" || req.method === "PATCH")) {
                    const body = await readJson(req);
                    const state = normaliseState(sessionId, body, req.method === "PATCH" && own(db.sessions, sessionId) ? db.sessions[sessionId] : {});
                    db.sessions[sessionId] = state;
                    if (!own(db.actions, sessionId)) db.actions[sessionId] = [];
                    saveDb();
                    return json(res, 200, state);
                }
                if (!suffix && req.method === "DELETE") {
                    delete db.sessions[sessionId];
                    delete db.actions[sessionId];
                    saveDb();
                    return json(res, 200, { ok: true });
                }
                if (suffix === "actions" && req.method === "POST") {
                    if (!own(db.sessions, sessionId)) throw new HttpError(404, `Unknown session: ${sessionId}`);
                    const body = await readJson(req);
                    const action = typeof body.action === "string" ? body.action.trim() : "";
                    if (!["pause", "resume", "cancel"].includes(action)) throw new HttpError(400, "Action must be pause, resume, or cancel");
                    const item = { id: db.nextActionId++, action, payload: body.payload ?? null, createdAt: new Date().toISOString() };
                    db.actions[sessionId] ??= [];
                    db.actions[sessionId].push(item);
                    saveDb();
                    return json(res, 202, item);
                }
                if (suffix === "actions" && req.method === "GET") {
                    const after = Number(url.searchParams.get("after") || 0);
                    if (!Number.isFinite(after) || after < 0) throw new HttpError(400, "Invalid action cursor");
                    return json(res, 200, (db.actions[sessionId] ?? []).filter(item => item.id > after));
                }
                throw new HttpError(405, "Method not allowed");
            }

            const card = cardRoute(url.pathname);
            if (card) {
                if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
                const resolveCard = cardHandlers.get(`${card.provider}:${card.kind}`)
                    ?? (expanded.supports(card.provider, card.kind) ? (requested, forceRefresh) => expanded.resolve(requested, forceRefresh) : null);
                if (!resolveCard) throw new HttpError(404, "Unknown card provider or kind");
                return json(res, 200, await resolveCard(card, url.searchParams.get("refresh") === "1"));
            }
            throw new HttpError(404, "Unknown API route");
        } catch (error) {
            const safe = error instanceof HttpError ? error
                : error instanceof ExpandedError && [400, 404, 409, 412, 429, 502, 503].includes(error.status)
                    ? new HttpError(error.status, error.message)
                    : new HttpError(500, "Internal bridge error");
            json(res, safe.status, { error: safe.message });
        }
    }

    const server = http.createServer(handler);
    return {
        server,
        get port() {
            const address = server.address();
            return typeof address === "object" && address ? address.port : config.port;
        },
        listen: () => new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(config.port, config.host, () => {
                server.off("error", reject);
                resolve();
            });
        }),
        close: () => {
            expanded.close();
            return new Promise(resolve => server.close(() => resolve()));
        }
    };
}
