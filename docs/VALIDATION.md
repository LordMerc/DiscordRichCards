# Validation

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
