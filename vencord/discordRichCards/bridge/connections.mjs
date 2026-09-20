import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

const LOCAL = new Set(["fivem", "minecraft", "dockhand", "statuspage"]);
const INTEGRATIONS = new Set(["twitch", "spotify", "youtube", "x", "steam"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const record = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 256) => typeof value === "string" && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

export function hasSecureStorage(storage, platform = process.platform) {
    return storage.isEncryptionAvailable() && (platform !== "linux" || (typeof storage.getSelectedStorageBackend === "function" && !["basic_text", "unknown"].includes(storage.getSelectedStorageBackend())));
}

function origin(value, httpsOnly = false) {
    try {
        const url = new URL(value);
        if (!text(value, 512) || !["http:", "https:"].includes(url.protocol) || (httpsOnly && url.protocol !== "https:")
            || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
        return url.origin;
    } catch { throw new Error("Connection address must be an HTTP(S) origin without credentials, path, query or fragment"); }
}

export function validateConnection(input) {
    if (!record(input) || (!LOCAL.has(input.provider) && !INTEGRATIONS.has(input.provider))) throw new Error("Unknown connection provider");
    if (!text(input.name, 80) || !input.name.trim()) throw new Error("Connection needs a name (maximum 80 characters)");
    if (input.id !== undefined && (typeof input.id !== "string" || !ID.test(input.id))) throw new Error("Invalid connection ID");
    if (!record(input.config)) throw new Error("Invalid connection settings");
    const c = input.config;
    let config;
    switch (input.provider) {
        case "fivem": {
            config = { baseUrl: origin(c.baseUrl) };
            if (c.joinUrl) {
                if (!text(c.joinUrl, 128) || !/^https:\/\/cfx\.re\/join\/[a-zA-Z0-9]{3,16}$/.test(c.joinUrl)) throw new Error("Join link must be a cfx.re/join link");
                config.joinUrl = c.joinUrl;
            }
            break;
        }
        case "minecraft": {
            if (!text(c.host, 253) || (!isIP(c.host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(c.host))) throw new Error("Invalid Minecraft host");
            const port = Number(c.port ?? 25565);
            if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Minecraft port");
            config = { host: c.host.toLowerCase(), port };
            break;
        }
        case "dockhand": {
            const environmentId = Number(c.environmentId);
            if (!Number.isSafeInteger(environmentId) || environmentId < 1) throw new Error("Dockhand needs a positive environment ID");
            if (!Array.isArray(c.containerNames) || c.containerNames.length > 50 || c.containerNames.some(n => !text(n, 128) || !n.trim())) throw new Error("Choose up to 50 container names");
            config = { baseUrl: origin(c.baseUrl), environmentId, containerNames: [...new Set(c.containerNames.map(n => n.trim()))] };
            break;
        }
        case "statuspage": config = { baseUrl: origin(c.baseUrl) }; break;
        case "twitch": case "spotify":
            if (!text(c.clientId, 128) || !/^[a-zA-Z0-9_-]+$/.test(c.clientId)) throw new Error("A valid application client ID is required");
            config = { clientId: c.clientId }; break;
        case "youtube": config = {}; break;
        case "x": {
            const budget = Number(c.maxRequestsPerHour ?? 10);
            if (!Number.isInteger(budget) || budget < 1 || budget > 100) throw new Error("Paid request budget must be between 1 and 100 per hour");
            if (c.allowPaidReads !== undefined && typeof c.allowPaidReads !== "boolean") throw new Error("Invalid paid-read setting");
            config = { allowPaidReads: c.allowPaidReads === true, maxRequestsPerHour: budget }; break;
        }
        case "steam":
            if (typeof c.country !== "string" || !/^[a-zA-Z]{2}$/.test(c.country)) throw new Error("Steam country must be a two-letter code");
            config = { country: c.country.toUpperCase() }; break;
    }
    return { ...(input.id ? { id: input.id } : {}), provider: input.provider, name: input.name.trim(), config };
}

function validateSecret(provider, secret, native = false) {
    const allowed = provider === "twitch" || provider === "spotify" ? ["clientSecret"]
        : provider === "youtube" ? ["apiKey"] : provider === "x" ? ["bearerToken"] : provider === "dockhand" && native ? ["session"] : [];
    if (!record(secret) || Object.entries(secret).some(([key, value]) => !allowed.includes(key) || !text(value, 8192) || !value)) throw new Error("Invalid connection credential");
    if (provider === "dockhand" && secret.session && !/^[a-zA-Z0-9._~+\/-]+={0,2}$/.test(secret.session)) throw new Error("Invalid Dockhand session credential");
    return { ...secret };
}

function binding(profile) {
    // All config changes invalidate secrets. This also protects future destination fields.
    return JSON.stringify([profile.provider, profile.config]);
}

export function createConnectionStore({ file, encrypt, decrypt, isEncryptionAvailable }) {
    let profiles;
    let revision = 0;
    let paidXRequests = [];
    function load() {
        if (profiles) return;
        try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
            if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.profiles) || parsed.profiles.length > 100) throw new Error();
            const usage = parsed.paidXRequests ?? [];
            if (!Array.isArray(usage) || usage.length > 100 || usage.some(time => !Number.isSafeInteger(time) || time < 0)) throw new Error();
            const ids = new Set();
            const integrations = new Set();
            const loaded = parsed.profiles.map(item => {
                const clean = validateConnection(item);
                if (!clean.id || ids.has(clean.id) || (INTEGRATIONS.has(clean.provider) && integrations.has(clean.provider))) throw new Error();
                ids.add(clean.id); integrations.add(clean.provider);
                let secret = {};
                if (item.encryptedSecret !== undefined) {
                    if (!isEncryptionAvailable() || !text(item.encryptedSecret, 65536) || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.encryptedSecret)) throw new Error();
                    secret = validateSecret(clean.provider, JSON.parse(decrypt(Buffer.from(item.encryptedSecret, "base64"))), true);
                }
                return { ...clean, secret };
            });
            profiles = loaded;
            paidXRequests = usage;
        } catch (error) {
            if (error?.code === "ENOENT") { profiles = []; return; }
            throw new Error("Cannot read stored connections; existing data has been preserved", { cause: error });
        }
    }
    function persist(next, usage = paidXRequests, configChanged = true) {
        const stored = next.map(({ secret, ...profile }) => {
            if (!Object.keys(secret).length) return profile;
            if (!isEncryptionAvailable()) throw new Error("OS credential encryption is unavailable; credentials were not saved");
            return { ...profile, encryptedSecret: Buffer.from(encrypt(JSON.stringify(secret))).toString("base64") };
        });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify({ version: 1, profiles: stored, paidXRequests: usage }), { mode: 0o600, flag: "wx" });
            fs.renameSync(temporary, file);
        } catch (error) {
            try { fs.unlinkSync(temporary); } catch { /* The temporary file may not have been created. */ }
            throw new Error("Could not save connections; previous settings were preserved", { cause: error });
        }
        profiles = next;
        paidXRequests = usage;
        if (configChanged) revision++;
    }
    const publicProfile = p => ({ id: p.id, provider: p.provider, name: p.name, config: structuredClone(p.config), hasCredential: Object.keys(p.secret).length > 0 });
    return {
        get revision() { return revision; },
        list() { load(); return profiles.map(publicProfile); },
        get(id) { load(); const p = profiles.find(p => p.id === id); return p ? structuredClone(p) : null; },
        integration(provider) { load(); const p = profiles.find(p => p.provider === provider); return p ? structuredClone(p) : null; },
        save(input) {
            load();
            const clean = validateConnection(input);
            const previous = clean.id ? profiles.find(p => p.id === clean.id) : null;
            if (clean.id && !previous) throw new Error("Connection no longer exists");
            if (!previous && profiles.length >= 100) throw new Error("Maximum saved connections reached");
            if (INTEGRATIONS.has(clean.provider) && profiles.some(p => p.provider === clean.provider && p.id !== clean.id)) throw new Error("Edit the existing provider connection instead");
            const secret = input.secret !== undefined ? validateSecret(clean.provider, input.secret)
                : previous && binding(previous) === binding(clean) ? previous.secret : {};
            const next = { ...clean, id: clean.id ?? randomUUID(), secret };
            persist([...profiles.filter(p => p.id !== next.id), next]);
            return publicProfile(next);
        },
        setSecret(id, input) {
            load();
            const previous = profiles.find(p => p.id === id);
            if (!previous) throw new Error("Connection no longer exists");
            const next = { ...previous, secret: validateSecret(previous.provider, input, true) };
            persist(profiles.map(p => p.id === id ? next : p));
        },
        clearSecret(id) {
            load();
            const previous = profiles.find(p => p.id === id);
            if (!previous) throw new Error("Connection no longer exists");
            const next = { ...previous, secret: {} };
            persist(profiles.map(p => p.id === id ? next : p));
            return publicProfile(next);
        },
        consumeXRequest(limit, now = Date.now()) {
            load();
            if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(now) || now < 0) throw new Error("Invalid paid request budget");
            const recent = paidXRequests.filter(time => time > now - 3600000);
            if (recent.length >= limit) return false;
            // Reserve before issuing the request; failed attempts still count, including across restarts.
            persist(profiles, [...recent, now], false);
            return true;
        },
        remove(id) {
            load();
            if (!profiles.some(p => p.id === id)) throw new Error("Connection no longer exists");
            persist(profiles.filter(p => p.id !== id));
        }
    };
}
