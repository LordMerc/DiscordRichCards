import { safeRobloxImageUrl } from "./bridge/robloxImages.mjs";
import { validRobloxEvent } from "./bridge/robloxEvents.mjs";
import type { HermesSessionState } from "./types";
import type { RobloxGame } from "./renderers/roblox/types";
import type { GitHubPR } from "./renderers/github/types";
import type { CodexReset } from "./renderers/codex/types";

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: Record<string, any>, keys: string[]) => keys.every(key => typeof value[key] === "string");
const numbers = (value: Record<string, any>, keys: string[]) => keys.every(key => Number.isFinite(value[key]) && value[key] >= 0);

export function validateHermes(value: unknown): value is HermesSessionState {
    if (!object(value) || value.version !== 1 || !strings(value, ["sessionId", "title", "status"])) return false;
    if (!["queued", "running", "waiting", "paused", "success", "error", "cancelled"].includes(value.status)) return false;
    if (!["agent", "model", "current", "startedAt", "updatedAt", "finishedAt"].every(k => value[k] == null || typeof value[k] === "string")) return false;
    if (value.progress != null && !Number.isFinite(value.progress)) return false;
    if (value.metrics != null && (!object(value.metrics) || !["tools", "tokens", "contextPercent"].every(k => value.metrics[k] == null || Number.isFinite(value.metrics[k])))) return false;
    if (value.actions != null && (!Array.isArray(value.actions) || !value.actions.every((a: unknown) => ["pause", "resume", "cancel"].includes(a as string)))) return false;
    return value.activity == null || (Array.isArray(value.activity) && value.activity.every((a: unknown) => object(a) && strings(a, ["id", "label", "status"]) && ["pending", "running", "success", "error", "skipped"].includes(a.status) && (a.detail == null || typeof a.detail === "string") && (a.durationMs == null || Number.isFinite(a.durationMs))));
}

export function validateGitHub(value: unknown): value is GitHubPR {
    return object(value) && strings(value, ["owner", "repo", "title", "author", "base", "head", "createdAt", "updatedAt", "url"])
        && numbers(value, ["number", "changedFiles", "additions", "deletions", "comments"])
        && ["open", "closed", "merged"].includes(value.state) && typeof value.draft === "boolean"
        && Array.isArray(value.labels) && value.labels.every((label: unknown) => typeof label === "string");
}

export function validateRoblox(value: unknown): value is RobloxGame {
    return object(value) && strings(value, ["name", "creator", "statusReason", "updatedAt"])
        && ["placeId", "universeId"].every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
        && ["playing", "favorites", "visits"].every(key => value[key] === null || (Number.isSafeInteger(value[key]) && value[key] >= 0))
        && ["open", "private", "locked", "unknown"].includes(value.status)
        && (value.events === undefined || (Array.isArray(value.events) && value.events.every(validRobloxEvent)))
        && (value.eventsStatus === undefined || ["ready", "stale", "unavailable"].includes(value.eventsStatus))
        && (value.eventsTruncated === undefined || typeof value.eventsTruncated === "boolean")
        && ["iconUrl", "thumbnailUrl"].every(key => value[key] == null || safeRobloxImageUrl(value[key]) !== null);
}

function nullableIsoDate(value: unknown): value is string | null {
    return value === null || (typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        && Number.isFinite(Date.parse(value)));
}

function safeCodexPostUrl(value: unknown): value is string | null {
    if (value === null) return true;
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
        if (url.hostname !== "x.com" && url.hostname !== "twitter.com") return false;
        return /^\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]*$/.test(url.pathname);
    } catch {
        return false;
    }
}

export function validateCodex(value: unknown): value is CodexReset {
    return object(value)
        && strings(value, ["tweetText", "rationale"])
        && ["yes", "no", "unknown"].includes(value.state)
        && ["active", "inactive", "unknown"].includes(value.monitor)
        && nullableIsoDate(value.checkedAt)
        && nullableIsoDate(value.resetAt)
        && safeCodexPostUrl(value.tweetUrl);
}
