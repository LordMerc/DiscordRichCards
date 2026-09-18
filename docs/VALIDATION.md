# Validation

## Provider expansion — 2026-09-18

- `node --test tests/*.test.mjs`: 60 passed, 0 failed. Includes existing providers plus new provider fixtures, canonical link parsing, presence expiry, encrypted connection storage, durable paid-request budget, bounded HTTP/Minecraft transports and credential clearing.
- `node scripts/build.mjs --dev-plugin` with `VENCORD_PATH=C:\Users\brand\Vencord`: isolated Vencord build and TypeScript check passed. Normal filesystem execution was required after the sandbox blocked esbuild traversal. The isolated build does not change the installed checkout. The Dev plugin was subsequently installed and rebuilt with user authorization; stable source and settings were preserved.
- `powershell -ExecutionPolicy Bypass -File scripts/package.ps1`: source archive generated; inspected for the new adapter/guide and absence of local profile/cache files, dependencies, builds and AGENTS.md.
- Live public smoke checks: Steam app 730 resolved to Counter-Strike 2, player count and allowed artwork; GitHub's Statuspage returned normalized service status. No paid X request or authenticated provider call was made.
- Independent critical review: PASS after durable X-budget, credential-clear and quote/media-reference corrections. Linux insecure-storage fallback is rejected and regression-tested.
- Live Dev verification: the user confirmed Steam rendering and numeric formatting, unauthenticated local Dockhand rendering, and the Roblox event-label spacing fix. Native Dockhand reads verified container details and recorded pending updates. The card labels container creation and update-check times separately; it does not claim a deployment timestamp or trigger updates.
- Spotify self-listening now uses LocalActivityStore while other users use PresenceStore; selection and expiry are fixture-tested. Its live behavior after that fix is not yet explicitly confirmed. Authenticated Spotify/Twitch/YouTube/X responses, Dockhand authenticated login, and live FiveM/Minecraft hosts remain unverified. No paid X calls were made.
- Follow-up independent reviews passed for optional Dockhand authentication, container metadata, Spotify activity selection, and Roblox event presentation. Native changes require a full Discord restart; CSS-only spacing changes were tested after reload.

Run `node --test tests/*.test.mjs` for the zero-dependency Node test suite.

Coverage includes marker compatibility and emoji substitution, polling cleanup/re-entry, response validation, Hermes publisher/action round trips, bridge authorization, malformed persisted state, GitHub caching/ETags/manual refresh/backoff, and embedded bridge lifecycle and persistence.

Set `VENCORD_PATH` to a Vencord checkout with dependencies installed, then run `node scripts/build.mjs`. This builds an isolated Vencord copy and runs TypeScript with dependency declaration checking skipped. Run `scripts/package.ps1` on Windows to produce the plugin source ZIP.

The initial release passed 16 automated tests and the Vencord development build/type check. Live smoke checks confirmed native bridge startup under Discord, a cached merged PR, unauthenticated API rejection, and preserved Hermes sessions. Open/merged card rendering has also been confirmed in Discord.

For each installed release, verify plugin enable/disable, public PR refresh, channel re-entry, Discord restart, and external Hermes actions. A successful build alone does not prove these UI behaviors.

## Roblox cards and development workflow

- All 27 automated tests pass, including existing GitHub/Hermes behavior, Roblox availability/cache/rate limits, optional artwork validation, refresh countdown and development plugin isolation.
- Vencord build and TypeScript checks pass. The development variant builds and runs beside stable with separate settings, cache and markers.
- Live public API checks for Anime Origins (place129932912185311, universe8946565814) returned renderer-valid stats and both artwork URLs. The user confirmed the card and artwork in Discord after the image-policy fix.
- Roblox's CDN requires an image-only CSP registration through Vencord's native plugin API. Full Discord restart is required for that registration.
- Private/locked/error states were tested with fixtures; account-specific join permission and live private-game behavior remain unverified.

For future changes, have the user verify the card, manual Refresh countdown, channel re-entry and plugin info link in Discord. Build and API checks alone cannot establish visible UI behavior.
