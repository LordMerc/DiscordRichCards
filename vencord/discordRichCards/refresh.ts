export const MANUAL_REFRESH_COOLDOWN_MS = 5_000;

export function getManualRefreshCooldownRemaining(cooldownUntil: number, now = Date.now()) {
    return Math.max(0, cooldownUntil - now);
}

export function getRefreshLabel(refreshing: boolean, cooldownRemaining: number) {
    if (cooldownRemaining > 0) return `Refresh (${Math.ceil(cooldownRemaining / 1000)}s)`;
    return refreshing ? "Refreshing…" : "Refresh";
}
