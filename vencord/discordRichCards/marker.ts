import type { RichCardDescriptor } from "./types";

export function parseMarkers(content: string): RichCardDescriptor[] {
    // One grammar for every provider; retain the old unwrapped/backtick syntax too.
    // Discord can consume both colons in :github: when it inserts a custom emoji.
    const pattern = /\[\[richcard(?::(?<provider>[a-z][a-z0-9-]*):|<a?:(?<emojiProvider>[a-z][a-z0-9-]*):[0-9]{1,20}>)(?<kind>[a-z][a-z0-9-]*):(?<reference>[^\]\r\n]{1,256})\]\]|(?:\[\[|`)?hermes-live:(?<session>[A-Za-z0-9._:-]{1,128})(?:\]\]|`)?/gi;
    return Array.from(content.matchAll(pattern), match => {
        const { provider, emojiProvider, kind, reference, session } = match.groups!;
        return {
            provider: session ? "hermes" : (provider ?? emojiProvider).toLowerCase(),
            kind: session ? "session" : kind.toLowerCase(),
            reference: session ?? reference,
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
