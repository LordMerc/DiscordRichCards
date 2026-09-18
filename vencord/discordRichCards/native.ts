import { app, IpcMainInvokeEvent } from "electron";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import { CspPolicies } from "@main/csp";
import { DATA_DIR } from "@main/utils/constants";
import { createManagedBridge } from "./bridge/managed.mjs";

// Discord blocks external image hosts unless registered before its page loads.
// Only images are allowed: APIs remain native requests and no script/connect rule is added.
CspPolicies["https://rbxcdn.com"] = ["img-src"];
CspPolicies["https://*.rbxcdn.com"] = ["img-src"];

const MAX_RESPONSE_BYTES = 1024 * 1024;
const managed = createManagedBridge({
    dataFile: join(DATA_DIR, "discord-richcards", "cards.json"),
    githubToken: process.env.RICHCARDS_GITHUB_TOKEN || ""
});
app.once("before-quit", () => { void managed.stop(); });

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
    if (!useExternalBridge) {
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
