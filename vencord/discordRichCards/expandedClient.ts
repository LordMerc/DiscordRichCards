import { expandedKinds } from "./bridge/providers.mjs";

export { expandedKinds };

export interface SummaryData {
    title: string;
    subtitle?: string;
    description?: string;
    status: "online" | "offline" | "live" | "scheduled" | "ended" | "healthy" | "degraded" | "outage" | "unknown" | "info";
    statusLabel: string;
    fields: { label: string; value: string; }[];
    url?: string;
    imageUrl?: string;
    startedAt?: string;
    endsAt?: string;
    copyText?: string;
    containers?: { name: string; state: string; status: string; image: string; updateStatus: "available" | "none-reported" | "unknown"; createdAt?: string; updateCheckedAt?: string; }[];
}

const countLabels = new Set(["Players", "Running", "Healthy", "Incidents", "Tracks", "Viewers", "Playing now", "Watching", "Likes"]);
const countFormatter = new Intl.NumberFormat();
export function formatSummaryField(field: SummaryData["fields"][number]): string {
    if (!countLabels.has(field.label) || !/^\d+(?: \/ \d+)?$/.test(field.value)) return field.value;
    const counts = field.value.split(" / ").map(Number);
    return counts.every(Number.isSafeInteger) ? counts.map(value => countFormatter.format(value)).join(" / ") : field.value;
}

const imageHosts = new Set(["i.scdn.co", "mosaic.scdn.co", "static-cdn.jtvnw.net", "cdn.akamai.steamstatic.com", "shared.akamai.steamstatic.com", "i.ytimg.com", "i9.ytimg.com", "pbs.twimg.com"]);
const actionHosts = new Set(["open.spotify.com", "www.twitch.tv", "twitch.tv", "store.steampowered.com", "www.youtube.com", "youtube.com", "x.com", "cfx.re"]);
const statuses = new Set(["online", "offline", "live", "scheduled", "ended", "healthy", "degraded", "outage", "unknown", "info"]);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, limit = 20000): value is string { return typeof value === "string" && value.length <= limit; }
export function safeSummaryUrl(value: unknown, image = false): value is string {
    if (!text(value, 2048)) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port && (image ? imageHosts : actionHosts).has(url.hostname);
    } catch { return false; }
}
export function validateSummary(value: unknown): value is SummaryData {
    if (!record(value) || !text(value.title, 1000) || !value.title.trim() || !text(value.statusLabel, 1000)
        || !text(value.status) || !statuses.has(value.status) || !Array.isArray(value.fields) || value.fields.length > 8) return false;
    if (value.fields.some(field => !record(field) || !text(field.label, 200) || !text(field.value, 2000))) return false;
    if (value.containers !== undefined && (!Array.isArray(value.containers) || value.containers.length > 50 || value.containers.some(item =>
        !record(item) || !text(item.name, 200) || !text(item.state, 80) || !text(item.status, 200) || !text(item.image, 300)
        || !["available", "none-reported", "unknown"].includes(String(item.updateStatus))
        || ["createdAt", "updateCheckedAt"].some(key => item[key] !== undefined && (!text(item[key], 100) || !Number.isFinite(Date.parse(item[key]))))))) return false;
    for (const key of ["subtitle", "description", "copyText"]) if (value[key] !== undefined && !text(value[key])) return false;
    if (value.url !== undefined && !safeSummaryUrl(value.url)) return false;
    if (value.imageUrl !== undefined && !safeSummaryUrl(value.imageUrl, true)) return false;
    for (const key of ["startedAt", "endsAt"]) if (value[key] !== undefined && (!text(value[key], 100) || !Number.isFinite(Date.parse(value[key])))) return false;
    return true;
}
export function validExpandedReference(provider: string, kind: string, reference: string) {
    if (!expandedKinds[provider]?.includes(kind)) return false;
    if (["fivem", "minecraft", "dockhand", "statuspage"].includes(provider)) return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reference);
    if (provider === "spotify") return kind === "live" ? /^[1-9][0-9]{16,19}$/.test(reference) : /^[A-Za-z0-9]{22}$/.test(reference);
    if (provider === "twitch") return /^[a-zA-Z0-9_]{1,25}$/.test(reference);
    if (provider === "youtube") return /^[a-zA-Z0-9_-]{11}$/.test(reference);
    return provider === "x" ? /^[1-9][0-9]{0,19}$/.test(reference) : /^[1-9][0-9]{0,9}$/.test(reference);
}

export function spotifyActivitiesForUser(reference: string, currentUserId: string | undefined, localActivities: unknown, presenceActivities: unknown): unknown[] | null {
    const activities = reference === currentUserId ? localActivities : presenceActivities;
    return Array.isArray(activities) ? activities : null;
}

export function spotifyActivity(activities: unknown, now = Date.now()): (SummaryData & { elapsedMs: number; durationMs: number; }) | null {
    if (!Array.isArray(activities)) return null;
    const activity = activities.find(a => record(a) && a.type === 2 && a.name === "Spotify" && typeof a.sync_id === "string" && /^[A-Za-z0-9]{22}$/.test(a.sync_id));
    if (!record(activity) || !record(activity.timestamps) || !text(activity.details, 1000)) return null;
    const { start, end } = activity.timestamps;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || start > now + 5000 || now >= end) return null;
    const assets = record(activity.assets) ? activity.assets : {};
    const image = typeof assets.large_image === "string" ? /^spotify:([a-fA-F0-9]{20,128})$/.exec(assets.large_image)?.[1] : null;
    return {
        title: activity.details, subtitle: text(activity.state, 1000) ? activity.state : undefined,
        description: text(assets.large_text, 1000) ? assets.large_text : undefined,
        status: "live", statusLabel: "Listening", fields: [], url: `https://open.spotify.com/track/${activity.sync_id}`,
        ...(image ? { imageUrl: `https://i.scdn.co/image/${image}` } : {}),
        elapsedMs: Math.max(0, now - start), durationMs: end - start
    };
}
