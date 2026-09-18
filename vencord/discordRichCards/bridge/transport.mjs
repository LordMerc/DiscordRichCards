import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { isIP } from "node:net";

export function isPrivateAddress(address) {
    if (typeof address !== "string") return false;
    const value = address.toLowerCase();
    if (isIP(value) === 4) {
        const [a, b] = value.split(".").map(Number);
        return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    if (isIP(value) === 6) {
        if (value.startsWith("::ffff:")) {
            const mapped = value.slice(7);
            if (isIP(mapped) === 4) return isPrivateAddress(mapped);
            const words = mapped.split(":");
            if (words.length !== 2) return false;
            const n = Number.parseInt(words[0], 16) * 65536 + Number.parseInt(words[1], 16);
            return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
        }
        return value === "::1" || /^(?:fc|fd)[0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value);
    }
    return false;
}

function localLookup(host, options, callback) {
    dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
        if (error || !addresses.length || addresses.some(a => !isPrivateAddress(a.address))) {
            callback(new Error("Connection must resolve to your local network")); return;
        }
        // Pin the addresses checked here to this socket; do not resolve a second time.
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
    });
}

/**
 * @param {string} urlString
 * @param {{method?: string, headers?: Record<string, string>, body?: unknown, localOnly?: boolean, signal?: AbortSignal}} options
 * @returns {Promise<{status: number, data: any, headers: Headers}>}
 */
export function requestJson(urlString, { method = "GET", headers = {}, body, localOnly = false, signal } = {}) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(urlString);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || !["GET", "POST"].includes(method)) throw new Error();
        } catch { reject(new Error("Invalid provider request")); return; }
        const hostname = url.hostname.replace(/^\[|\]$/g, "");
        if (localOnly && isIP(hostname) && !isPrivateAddress(hostname)) { reject(new Error("Connection must resolve to your local network")); return; }
        if (signal?.aborted) { reject(new Error("Provider request cancelled")); return; }
        let request;
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (error) { reject(error); request?.destroy(); } else resolve(result);
        };
        const abort = () => finish(new Error("Provider request cancelled"));
        const timer = setTimeout(() => finish(new Error("Provider request timed out")), 8000);
        signal?.addEventListener("abort", abort, { once: true });
        try {
            const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
            if (payload && Buffer.byteLength(payload) > 65536) { finish(new Error("Provider request exceeds size limit")); return; }
            request = (url.protocol === "https:" ? https : http).request(url, {
                method, agent: false,
                headers: { Accept: "application/json", "User-Agent": "DiscordRichCards/1.0", ...headers, ...(payload === undefined ? {} : { "Content-Length": String(Buffer.byteLength(payload)) }) },
                ...(localOnly ? { lookup: localLookup } : {})
            }, response => {
                const status = response.statusCode ?? 0;
                if (status >= 300 && status < 400) { response.destroy(); finish(new Error("Provider redirect was refused")); return; }
                const chunks = [];
                let bytes = 0;
                response.on("data", chunk => {
                    bytes += chunk.length;
                    if (bytes > 1024 * 1024) { response.destroy(); finish(new Error("Provider response exceeds size limit")); return; }
                    chunks.push(chunk);
                });
                response.on("error", () => finish(new Error("Provider response interrupted")));
                response.on("end", () => {
                    if (settled) return;
                    let data = null;
                    try { if (chunks.length) data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
                    catch { finish(new Error("Provider returned invalid JSON")); return; }
                    const resultHeaders = new Headers();
                    for (const [key, value] of Object.entries(response.headers)) {
                        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) resultHeaders.append(key, item);
                    }
                    finish(null, { status, data, headers: resultHeaders });
                });
            });
            request.on("error", error => finish(new Error(error.message === "Connection must resolve to your local network" ? error.message : "Provider connection unavailable")));
            if (payload !== undefined) request.write(payload);
            request.end();
        } catch { finish(new Error("Provider request failed")); }
    });
}
