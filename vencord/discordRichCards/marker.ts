import type { RichCardDescriptor } from "./types";

export interface ComposerCard {
    provider: "github" | "roblox" | "codex";
    kind: "pr" | "game" | "reset";
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

    return null;
}

export function buildComposerInsertion(card: ComposerCard, includeUrl: boolean) {
    const marker = card.provider === "codex" ? "[[richcard:codexreset]]" : `[[richcard:${card.provider}:${card.kind}:${card.reference}]]`;
    return includeUrl ? `${marker} ${card.url} ` : `${marker} `;
}
