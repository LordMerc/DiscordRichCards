# Architecture

Discord messages provide persistent anchors and ordinary fallback text. The plugin parses the marker, selects a renderer through its registry, and resolves authoritative data through a native bridge. Remounting a message fetches its state again.

- `vencord/discordRichCards/index.tsx`: Vencord registration and accessory lifecycle.
- `marker.ts` / `registry.ts`: marker validation and provider-specific renderers.
- `useCard.ts` / `polling.ts`: sequential refresh, cleanup, outage recovery and deferred manual refresh.
- `native.ts` / `bridge/managed.mjs`: Electron-owned loopback bridge lifecycle and private credentials.
- `bridge/runtime.mjs` inside the plugin: shared provider API, persistence and GitHub caching.
- Root `bridge/server.mjs`: optional standalone bridge entry point for Hermes or external mode.

Provider data remains separate from presentation. GitHub is read-only and uses conditional requests with bounded refreshes and failure backoff. Hermes retains its legacy session/action API. Neither component memory nor repeated edits to Discord messages are authoritative.
