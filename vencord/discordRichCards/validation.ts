import { safeRobloxImageUrl } from "./bridge/robloxImages.mjs";
import type { HermesSessionState } from "./types";
import type { RobloxGame } from "./renderers/roblox/types";
import type { GitHubPR } from "./renderers/github/types";

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
        && ["iconUrl", "thumbnailUrl"].every(key => value[key] == null || safeRobloxImageUrl(value[key]) !== null);
}
