const MINUTE_MS = 60_000;
const DEFAULT_TTL_MS = MINUTE_MS;

/**
 * Single source of truth for the summary-card providers. Kinds with
 * `bridgeBacked: false` are rendered from client-side data only and are never
 * resolved by the bridge.
 */
export const PROVIDERS = /** @type {const} */ ({
    fivem: { label: "FiveM", glyph: "F", kinds: { server: { bridgeBacked: true, ttlMs: 30_000 } } },
    minecraft: { label: "Minecraft", glyph: "M", kinds: { server: { bridgeBacked: true, ttlMs: 30_000 } } },
    dockhand: { label: "Dockhand", glyph: "D", kinds: { status: { bridgeBacked: true, ttlMs: 30_000 } } },
    statuspage: { label: "Service status", glyph: "●", kinds: { status: { bridgeBacked: true, ttlMs: 30_000 } } },
    spotify: {
        label: "Spotify", glyph: "♫",
        kinds: {
            track: { bridgeBacked: true, ttlMs: 5 * MINUTE_MS },
            playlist: { bridgeBacked: true, ttlMs: 5 * MINUTE_MS },
            live: { bridgeBacked: false }
        }
    },
    twitch: { label: "Twitch", glyph: "T", kinds: { channel: { bridgeBacked: true, ttlMs: 30_000 } } },
    steam: { label: "Steam", glyph: "S", kinds: { game: { bridgeBacked: true, ttlMs: 5 * MINUTE_MS } } },
    youtube: { label: "YouTube", glyph: "▶", kinds: { live: { bridgeBacked: true, ttlMs: 30_000 } } },
    x: { label: "X", glyph: "𝕏", kinds: { post: { bridgeBacked: true, ttlMs: 10 * MINUTE_MS } } }
});

/** @typedef {keyof typeof PROVIDERS} ExpandedProvider */
/** @typedef {{ [P in ExpandedProvider]: keyof typeof PROVIDERS[P]["kinds"] }[ExpandedProvider]} ExpandedKind */

const entries = Object.entries(PROVIDERS);

/** @type {readonly string[]} */
export const expandedProviders = entries.map(([provider]) => provider);

/** @type {Record<string, string[]>} */
export const expandedKinds = Object.fromEntries(entries.map(([provider, definition]) => [provider, Object.keys(definition.kinds)]));

/** @type {Record<string, string>} */
export const providerLabels = Object.fromEntries(entries.map(([provider, definition]) => [provider, definition.label]));

/** @type {Record<string, string>} */
export const providerGlyphs = Object.fromEntries(entries.map(([provider, definition]) => [provider, definition.glyph]));

/** `provider:kind` pairs the bridge resolves. */
export const bridgeBackedKinds = new Set(entries.flatMap(([provider, definition]) =>
    Object.entries(definition.kinds).filter(([, kind]) => kind.bridgeBacked).map(([kind]) => `${provider}:${kind}`)));

/** @param {string} provider */
export function isExpandedProvider(provider) {
    return Object.hasOwn(PROVIDERS, provider);
}

/**
 * @param {string} provider
 * @param {string} kind
 */
export function isBridgeBacked(provider, kind) {
    return bridgeBackedKinds.has(`${provider}:${kind}`);
}

/**
 * @param {string} provider
 * @param {string} kind
 */
export function bridgeTtlMs(provider, kind) {
    /** @type {{ bridgeBacked: boolean; ttlMs?: number } | undefined} */
    const definition = isExpandedProvider(provider) ? PROVIDERS[/** @type {ExpandedProvider} */ (provider)].kinds[kind] : undefined;
    return definition?.ttlMs ?? DEFAULT_TTL_MS;
}
