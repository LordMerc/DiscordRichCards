import { app, IpcMainInvokeEvent, safeStorage } from "electron";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import { CspPolicies } from "@main/csp";
import { DATA_DIR } from "@main/utils/constants";
import { createManagedBridge } from "./bridge/managed.mjs";
import { createConnectionStore, hasSecureStorage } from "./bridge/connections.mjs";
import { requestJson as providerRequest } from "./bridge/transport.mjs";
import { minecraftStatus } from "./bridge/minecraft.mjs";

// Discord blocks external image hosts unless registered before its page loads.
// Only images are allowed: APIs remain native requests and no script/connect rule is added.
CspPolicies["https://rbxcdn.com"] = ["img-src"];
CspPolicies["https://*.rbxcdn.com"] = ["img-src"];
for (const host of ["i.scdn.co", "mosaic.scdn.co", "static-cdn.jtvnw.net", "cdn.akamai.steamstatic.com", "shared.akamai.steamstatic.com", "i.ytimg.com", "i9.ytimg.com", "pbs.twimg.com"]) {
    CspPolicies[`https://${host}`] = ["img-src"];
}

const connections = createConnectionStore({
    file: join(DATA_DIR, "discord-richcards", "connections.json"),
    encrypt: (text: string) => safeStorage.encryptString(text),
    decrypt: (bytes: Buffer) => safeStorage.decryptString(bytes),
    isEncryptionAvailable: () => hasSecureStorage(safeStorage)
});

const MAX_RESPONSE_BYTES = 1024 * 1024;
const managed = createManagedBridge({
    dataFile: join(DATA_DIR, "discord-richcards", "cards.json"),
    githubToken: process.env.RICHCARDS_GITHUB_TOKEN || "",
    providerOptions: {
        getProfile: (id: string) => connections.get(id),
        getIntegration: (provider: string) => connections.integration(provider),
        getRevision: () => connections.revision,
        consumeXRequest: (limit: number, now: number) => connections.consumeXRequest(limit, now),
        requestJson: providerRequest,
        minecraftStatus
    }
});
app.once("before-quit", () => { void managed.stop(); });

export interface ConnectionInput {
    id?: string;
    provider: string;
    name: string;
    config: Record<string, unknown>;
    secret?: Record<string, string>;
}
export interface PublicConnection {
    id: string;
    provider: string;
    name: string;
    config: Record<string, unknown>;
    hasCredential: boolean;
}

export async function listConnections(_: IpcMainInvokeEvent): Promise<{ ok: boolean; data?: PublicConnection[]; error?: string; }> {
    try { return { ok: true, data: connections.list() }; }
    catch { return { ok: false, error: "Could not read connections. Existing data has been preserved." }; }
}
export async function saveConnection(_: IpcMainInvokeEvent, input: ConnectionInput): Promise<{ ok: boolean; data?: PublicConnection; error?: string; }> {
    try { return { ok: true, data: connections.save(input) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not save connection" }; }
}
export async function removeConnection(_: IpcMainInvokeEvent, id: string) {
    try { connections.remove(id); return { ok: true }; }
    catch { return { ok: false, error: "Could not remove connection. Existing data has been preserved." }; }
}

export async function removeCredential(_: IpcMainInvokeEvent, id: string): Promise<{ ok: boolean; data?: PublicConnection; error?: string; }> {
    try { return { ok: true, data: connections.clearSecret(id) }; }
    catch { return { ok: false, error: "Could not clear credential. Existing data has been preserved." }; }
}

export async function connectDockhand(_: IpcMainInvokeEvent, id: string, username: string, password: string, mfaToken = "") {
    try {
        const profile = connections.get(id);
        if (!profile || profile.provider !== "dockhand") return { ok: false, error: "Save a Dockhand connection first" };
        if (typeof username !== "string" || !username || username.length > 256 || typeof password !== "string" || !password || password.length > 4096
            || typeof mfaToken !== "string" || (mfaToken && !/^\d{6,8}$/.test(mfaToken))) return { ok: false, error: "Enter a username, password and valid MFA code if required" };
        if (!hasSecureStorage(safeStorage)) return { ok: false, error: "OS credential encryption is unavailable" };
        const revision = connections.revision;
        const response = await providerRequest(`${profile.config.baseUrl}/api/auth/login`, {
            method: "POST", headers: { "Content-Type": "application/json" }, localOnly: true,
            body: { username, password, ...(mfaToken ? { mfaToken } : {}) }
        });
        if (connections.revision !== revision) return { ok: false, error: "Connection settings changed during login; retry" };
        if (response.data?.requiresMfa === true) return { ok: false, error: "Dockhand requires an MFA code. Enter it and reconnect." };
        if (response.status !== 200 || response.data?.success !== true) return { ok: false, error: "Dockhand login failed. Check local login, credentials and MFA." };
        const cookies = response.headers.getSetCookie();
        const session = cookies.map(cookie => /^dockhand_session=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
        if (!session) return { ok: false, error: "Dockhand did not return a supported session" };
        connections.setSecret(id, { session });
        return { ok: true, data: "Connected. Your password was not saved." };
    } catch { return { ok: false, error: "Could not connect to Dockhand or securely save its session" }; }
}

export async function testConnection(_: IpcMainInvokeEvent, id: string) {
    try {
        const profile = connections.get(id);
        if (!profile) return { ok: false, error: "Connection no longer exists" };
        const revision = connections.revision;
        if (profile.provider === "minecraft") {
            await minecraftStatus(profile.config);
        } else if (["dockhand", "fivem", "statuspage"].includes(profile.provider)) {
            const endpoint = profile.provider === "dockhand" ? `/api/containers?env=${profile.config.environmentId}&all=true`
                : profile.provider === "fivem" ? "/dynamic.json" : "/api/v2/summary.json";
            const response = await providerRequest(`${profile.config.baseUrl}${endpoint}`, {
                localOnly: profile.provider === "dockhand",
                headers: profile.provider === "dockhand" && profile.secret.session ? { Cookie: `dockhand_session=${profile.secret.session}` } : {}
            });
            if (response.status < 200 || response.status >= 300) return { ok: false, error: `Service returned HTTP ${response.status}. Check the connection or reconnect.` };
            if (profile.provider === "dockhand" && !Array.isArray(response.data)) return { ok: false, error: "Dockhand returned an unsupported response" };
            if (profile.provider === "dockhand" && response.data.length === 0) return { ok: true, data: "Dockhand responded, but no containers were returned. Check the environment; this does not confirm its health." };
        } else {
            if (profile.provider !== "steam" && !Object.keys(profile.secret).length) return { ok: false, error: "This integration needs credentials" };
            return { ok: true, data: "Settings are saved. Preview a card to verify API access; this check did not make a billed API call." };
        }
        if (revision !== connections.revision) return { ok: false, error: "Connection changed during the test; retry" };
        return { ok: true, data: "Service responded successfully" };
    } catch { return { ok: false, error: "Connection test failed. Check the service address, local network and credentials." }; }
}

export async function startManagedBridge(_: IpcMainInvokeEvent) {
    try {
        await managed.start();
        return { ok: true };
    } catch {
        return { ok: false, error: "Could not start the built-in bridge. Check that Vencord's data folder is writable and its RichCards cache is valid." };
    }
}

export async function stopManagedBridge(_: IpcMainInvokeEvent) {
    await managed.stop();
    return { ok: true };
}

function requestJson(
    urlString: string,
    method: "GET" | "POST",
    token: string,
    body: unknown,
    acceptSelfSigned: boolean
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; }> {
    return new Promise(resolve => {
        let url: URL;
        try {
            url = new URL(urlString);
        } catch {
            resolve({ ok: false, status: 0, error: "Invalid bridge URL" });
            return;
        }

        if (url.protocol !== "http:" && url.protocol !== "https:") {
            resolve({ ok: false, status: 0, error: "Bridge URL must use http:// or https://" });
            return;
        }

        const bodyText = body == null ? undefined : JSON.stringify(body);
        const headers: Record<string, string> = {
            "Accept": "application/json",
            "User-Agent": "DiscordRichCards-Vencord/1.0.0"
        };

        if (token) headers.Authorization = `Bearer ${token}`;
        if (bodyText != null) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = String(Buffer.byteLength(bodyText));
        }

        const transport = url.protocol === "https:" ? https : http;
        const req = transport.request(url, {
            method,
            headers,
            ...(url.protocol === "https:" ? { rejectUnauthorized: !acceptSelfSigned } : {})
        }, res => {
            const chunks: Buffer[] = [];
            let bytes = 0;

            res.on("data", chunk => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += buffer.length;
                if (bytes > MAX_RESPONSE_BYTES) {
                    req.destroy(new Error("Bridge response exceeded 1 MiB"));
                    return;
                }
                chunks.push(buffer);
            });

            res.on("error", () => resolve({ ok: false, status: 0, error: "Bridge response interrupted" }));
            res.on("end", () => {
                const status = res.statusCode ?? 0;
                const text = Buffer.concat(chunks).toString("utf8");
                let data: unknown = undefined;

                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch {
                        resolve({ ok: false, status, error: `Bridge returned non-JSON (${status})` });
                        return;
                    }
                }

                if (status < 200 || status >= 300) {
                    const message = typeof data === "object" && data && "error" in data
                        ? String((data as { error?: unknown; }).error)
                        : `HTTP ${status}`;
                    resolve({ ok: false, status, data, error: message });
                    return;
                }

                resolve({ ok: true, status, data });
            });
        });

        const deadline = setTimeout(() => req.destroy(new Error("Bridge request timed out")), 10000);
        req.on("close", () => clearTimeout(deadline));
        req.on("error", () => resolve({ ok: false, status: 0, error: "Bridge unavailable or request timed out" }));
        if (bodyText != null) req.write(bodyText);
        req.end();
    });
}

export async function getCard(
    _: IpcMainInvokeEvent, baseUrl: string, provider: string, kind: string,
    reference: string, token: string, acceptSelfSigned: boolean, refresh = false, useExternalBridge = false
) {
    if (!useExternalBridge || ["fivem", "minecraft", "dockhand", "statuspage", "spotify", "twitch", "steam", "youtube", "x"].includes(provider)) {
        try {
            const local = await managed.connection();
            baseUrl = local.url;
            token = local.token;
            acceptSelfSigned = false;
        } catch {
            return { ok: false, status: 0, error: "Built-in bridge unavailable. Toggle DiscordRichCards off and on to retry." };
        }
    }
    return requestJson(
        buildUrl(baseUrl, `/api/cards/${encodeURIComponent(provider)}/${encodeURIComponent(kind)}/${encodeURIComponent(reference)}${refresh ? "?refresh=1" : ""}`),
        "GET", token, undefined, acceptSelfSigned
    );
}

function buildUrl(baseUrl: string, path: string) {
    return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function getSession(
    _: IpcMainInvokeEvent,
    baseUrl: string,
    sessionId: string,
    token: string,
    acceptSelfSigned: boolean
) {
    return requestJson(
        buildUrl(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}`),
        "GET",
        token,
        undefined,
        acceptSelfSigned
    );
}

export async function sendAction(
    _: IpcMainInvokeEvent,
    baseUrl: string,
    sessionId: string,
    action: string,
    token: string,
    acceptSelfSigned: boolean
) {
    return requestJson(
        buildUrl(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/actions`),
        "POST",
        token,
        { action },
        acceptSelfSigned
    );
}
