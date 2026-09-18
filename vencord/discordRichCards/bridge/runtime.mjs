import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MAX_BODY = 1024 * 1024;
const MIN_AUTOMATIC_UPSTREAM_INTERVAL_MS = 15_000;
const MIN_MANUAL_UPSTREAM_INTERVAL_MS = 5_000;
const OPEN_PULL_TTL_MS = 30_000;
const CLOSED_PULL_TTL_MS = 120_000;
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
        now: options.now ?? Date.now
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

export function createBridge(options = {}) {
    const config = configFrom(options);
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("Invalid bridge port");
    if (typeof config.fetch !== "function") throw new Error("A fetch implementation is required");
    if (!config.token && (config.githubToken || !isLoopbackHost(config.host))) {
        throw new Error("RICHCARDS_TOKEN must be set for a non-loopback bridge or when RICHCARDS_GITHUB_TOKEN is configured");
    }
    const db = loadDb(config.dataFile);
    const pending = new Map();

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

    async function resolveGithubPull(reference, forceRefresh) {
        const identity = parsePullReference(reference);
        const key = `github:pr:${reference}`;
        const existing = own(db.cards, key) ? db.cards[key] : null;
        const now = config.now();
        if (existing?.backoffUntil > now) {
            if (existing.data) return cardEnvelope(existing, { stale: true, warning: existing.backoffMessage ?? "GitHub is temporarily unavailable" });
            throw new HttpError(existing.backoffStatus ?? 502, existing.backoffMessage ?? "GitHub is temporarily unavailable");
        }
        if (pending.has(key)) return pending.get(key);

        const fresh = existing && now - existing.fetchedAt < existing.refreshAfterMs;
        const automaticTooSoon = existing && now - (existing.lastAttemptAt ?? 0) < MIN_AUTOMATIC_UPSTREAM_INTERVAL_MS;
        if (!forceRefresh && existing && (fresh || automaticTooSoon)) return cardEnvelope(existing);

        const manualDeferredMs = forceRefresh && existing && Math.max(0, MIN_MANUAL_UPSTREAM_INTERVAL_MS - (now - (existing.lastManualAttemptAt ?? 0)));
        if (manualDeferredMs) return cardEnvelope(existing, { refreshDeferredMs: manualDeferredMs });

        const work = (async () => {
            const headers = {
                accept: "application/vnd.github+json",
                "user-agent": "Discord-RichCards-Bridge/1.0",
                ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
                ...(existing?.etag ? { "if-none-match": existing.etag } : {})
            };
            const attemptAt = config.now();
            const lastManualAttemptAt = forceRefresh ? attemptAt : existing?.lastManualAttemptAt;
            if (forceRefresh && existing) existing.lastManualAttemptAt = attemptAt;
            try {
                const { response, raw } = await fetchGithubPull(`https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/pulls/${identity.number}`, headers);
                if (response.status === 304 && existing) {
                    existing.fetchedAt = config.now();
                    existing.lastAttemptAt = attemptAt;
                    existing.lastManualAttemptAt = lastManualAttemptAt;
                    existing.etag = response.headers.get("etag") ?? existing.etag;
                    delete existing.backoffUntil;
                    saveDb();
                    return cardEnvelope(existing);
                }
                const data = normalizePull(raw, identity);
                const entry = {
                    key,
                    provider: "github",
                    kind: "pr",
                    data,
                    fetchedAt: config.now(),
                    refreshAfterMs: data.state === "open" ? OPEN_PULL_TTL_MS : CLOSED_PULL_TTL_MS,
                    lastAttemptAt: attemptAt,
                    lastManualAttemptAt,
                    etag: response.headers.get("etag") ?? undefined
                };
                db.cards[key] = entry;
                saveDb();
                return cardEnvelope(entry);
            } catch (error) {
                const safe = error instanceof HttpError ? error : new HttpError(502, "GitHub is temporarily unavailable");
                const entry = existing ?? { key, provider: "github", kind: "pr", data: null, fetchedAt: 0, refreshAfterMs: 0 };
                entry.lastAttemptAt = attemptAt;
                entry.lastManualAttemptAt = lastManualAttemptAt;
                entry.backoffUntil = config.now() + (safe.status === 429 ? 60_000 : 30_000);
                entry.backoffStatus = safe.status;
                entry.backoffMessage = safe.message;
                db.cards[key] = entry;
                saveDb();
                if (entry.data) return cardEnvelope(entry, { stale: true, warning: safe.message });
                throw safe;
            } finally {
                pending.delete(key);
            }
        })();
        pending.set(key, work);
        return work;
    }

    const cardHandlers = new Map([
        ["hermes:session", async card => {
            if (!safeId(card.reference)) throw new HttpError(400, "Invalid session id");
            if (!own(db.sessions, card.reference)) throw new HttpError(404, `Unknown session: ${card.reference}`);
            const state = db.sessions[card.reference];
            return cardEnvelope({ key: `hermes:session:${card.reference}`, provider: "hermes", kind: "session", fetchedAt: Date.parse(state.updatedAt) || config.now(), refreshAfterMs: 1_000, data: state });
        }],
        ["github:pr", async (card, forceRefresh) => resolveGithubPull(card.reference, forceRefresh)]
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
                const resolveCard = cardHandlers.get(`${card.provider}:${card.kind}`);
                if (!resolveCard) throw new HttpError(404, "Unknown card provider or kind");
                return json(res, 200, await resolveCard(card, url.searchParams.get("refresh") === "1"));
            }
            throw new HttpError(404, "Unknown API route");
        } catch (error) {
            const safe = error instanceof HttpError ? error : new HttpError(500, "Internal bridge error");
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
        close: () => new Promise(resolve => server.close(() => resolve()))
    };
}
