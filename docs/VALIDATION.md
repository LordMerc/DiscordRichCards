# Validation

Run `node --test tests/*.test.mjs` for the zero-dependency Node test suite.

Coverage includes marker compatibility and emoji substitution, polling cleanup/re-entry, response validation, Hermes publisher/action round trips, bridge authorization, malformed persisted state, GitHub caching/ETags/manual refresh/backoff, and embedded bridge lifecycle and persistence.

Set `VENCORD_PATH` to a Vencord checkout with dependencies installed, then run `node scripts/build.mjs`. This builds an isolated Vencord copy and runs TypeScript with dependency declaration checking skipped. Run `scripts/package.ps1` on Windows to produce the plugin source ZIP.

The initial release passed 16 automated tests and the Vencord development build/type check. Live smoke checks confirmed native bridge startup under Discord, a cached merged PR, unauthenticated API rejection, and preserved Hermes sessions. Open/merged card rendering has also been confirmed in Discord.

For each installed release, verify plugin enable/disable, public PR refresh, channel re-entry, Discord restart, and external Hermes actions. A successful build alone does not prove these UI behaviors.
