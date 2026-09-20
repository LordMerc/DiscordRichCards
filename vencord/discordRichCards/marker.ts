import type { ExpandedKind, ExpandedProvider } from "./bridge/providers.mjs";
import type { RichCardDescriptor } from "./types";

export interface ComposerCard {
    provider: "github" | "roblox" | "codex" | ExpandedProvider;
    kind: "pr" | "game" | "reset" | ExpandedKind;
    reference: string;
    url: string;
}

export function parseMarkers(content: string): RichCardDescriptor[] {
    // One grammar for every provider; retain the old unwrapped/backtick syntax too.
    // Discord can consume both colons in :github: when it inserts a custom emoji.
    const pattern = /\[\[richcard(?::(?<codexReset>codexreset)|(?::(?<provider>[a-z][a-z0-9-]*):|<a?:(?<emojiProvider>[a-z][a-z0-9-]*):[0-9]{1,20}>)(?<kind>[a-z][a-z0-9-]*):(?<reference>[^\]\r\n]{1,256}))\]\]|(?:\[\[|`)?hermes-live:(?<session>[A-Za-z0-9._:-]{1,128})(?:\]\]|`)?/gi;
    return Array.from(content.matchAll(pattern), match => {
        const { provider, emojiProvider, kind, reference, session, codexReset } = match.groups!;
        return {
            provider: codexReset ? "codex" : session ? "hermes" : (provider ?? emojiProvider).toLowerCase(),
            kind: codexReset ? "reset" : session ? "session" : kind.toLowerCase(),
            reference: codexReset ? "today" : session ?? reference,
            rawMarker: match[0]
        };
    });
}

export function parseGitHubPRRef(reference: string) {
    const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]*)$/.exec(reference);
    if (!match || [".", ".."].includes(match[2])) return null;
    const number = Number(match[3]);
    return Number.isSafeInteger(number) ? { owner: match[1], repo: match[2], number } : null;
}

export function parseRobloxGameRef(reference: string): number | null {
    if (!/^[1-9][0-9]{0,15}$/.test(reference)) return null;
    const id = Number(reference);
    return Number.isSafeInteger(id) ? id : null;
}

export function parseCodexResetRef(reference: string) {
    return reference === "today" ? reference : null;
}

function pathSegments(pathname: string, count: number) {
    const segments = pathname.split("/").filter(Boolean);
    return segments.length === count ? segments : null;
}

export function parseComposerLink(value: string): ComposerCard | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

    if (url.hostname === "github.com") {
        const parts = pathSegments(url.pathname, 4);
        if (!parts || parts[2] !== "pull") return null;
        const reference = `${parts[0]}/${parts[1]}#${parts[3]}`;
        return parseGitHubPRRef(reference) ? { provider: "github", kind: "pr", reference, url: url.toString() } : null;
    }

    if (url.hostname === "www.roblox.com" || url.hostname === "roblox.com") {
        const parts = pathSegments(url.pathname, 2) ?? pathSegments(url.pathname, 3);
        if (!parts || parts[0] !== "games") return null;
        const reference = parts[1];
        return parseRobloxGameRef(reference) ? { provider: "roblox", kind: "game", reference, url: url.toString() } : null;
    }

    if (url.hostname === "hascodexratelimitreset.today" && url.pathname === "/" && !url.search && !url.hash) {
        return { provider: "codex", kind: "reset", reference: "today", url: "https://hascodexratelimitreset.today/" };
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "open.spotify.com" && parts.length === 2 && ["track", "playlist"].includes(parts[0]) && /^[A-Za-z0-9]{22}$/.test(parts[1])) {
        return { provider: "spotify", kind: parts[0] as "track" | "playlist", reference: parts[1], url: `https://open.spotify.com/${parts[0]}/${parts[1]}` };
    }
    if (["www.twitch.tv", "twitch.tv"].includes(url.hostname) && parts.length === 1 && /^[A-Za-z0-9_]{1,25}$/.test(parts[0]) && !["directory", "videos", "settings", "downloads", "subscriptions", "inventory", "wallet", "search", "jobs", "turbo"].includes(parts[0].toLowerCase())) {
        const reference = parts[0].toLowerCase();
        return { provider: "twitch", kind: "channel", reference, url: `https://www.twitch.tv/${reference}` };
    }
    if (url.hostname === "store.steampowered.com" && [2, 3].includes(parts.length) && parts[0] === "app" && /^[1-9][0-9]{0,9}$/.test(parts[1])) {
        return { provider: "steam", kind: "game", reference: parts[1], url: `https://store.steampowered.com/app/${parts[1]}/` };
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) {
        const reference = url.hostname === "youtu.be" && parts.length === 1 ? parts[0]
            : url.pathname === "/watch" ? url.searchParams.get("v") : parts.length === 2 && parts[0] === "live" ? parts[1] : null;
        if (reference && /^[A-Za-z0-9_-]{11}$/.test(reference)) return { provider: "youtube", kind: "live", reference, url: `https://www.youtube.com/watch?v=${reference}` };
    }
    if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) && parts.length === 3 && /^[A-Za-z0-9_]{1,15}$/.test(parts[0]) && parts[1] === "status" && /^[1-9][0-9]{0,19}$/.test(parts[2])) {
        return { provider: "x", kind: "post", reference: parts[2], url: `https://x.com/${parts[0]}/status/${parts[2]}` };
    }

    return null;
}

export function buildComposerInsertion(card: ComposerCard, includeUrl: boolean) {
    const marker = card.provider === "codex" ? "[[richcard:codexreset]]" : `[[richcard:${card.provider}:${card.kind}:${card.reference}]]`;
    return includeUrl && card.url ? `${marker} ${card.url} ` : `${marker} `;
}
