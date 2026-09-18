// Shared by the native provider and renderer validation. No arbitrary image hosts.
export function safeRobloxImageUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port
            && /^(?:[a-z0-9-]+\.)*rbxcdn\.com$/.test(url.hostname) ? url.href : null;
    } catch { return null; }
}
