# RichCards provider expansion

Status: approved and implemented in source, 2026-09-18. Installation and visible Discord verification remain separate. See the distributable CONNECTIONS.md for initial provider limitations and setup.

## Goal and confirmed decisions

Add FiveM and Minecraft server cards, Spotify music cards, Twitch channels, Steam games, YouTube livestreams, X posts, and service status including Dockhand. Integrate them into the existing Create RichCard composer and plugin settings. Keep current GitHub, Roblox, Codex, and Hermes behavior intact.

The user selected local-network-only Dockhand status for the first version. Each viewer resolves cards using their own configured connections; a message does not publish private data or grant access to someone else's network. Viewers without the relevant configuration see a setup/unavailable state.

Canonical checkout inspected at a16e2ca. The working tree was clean before this document. Existing source already contains a renderer registry, shared refresh scheduling, a composer with previews, and an Electron-owned bridge. Extend these paths rather than introducing another service.

## Card behavior

| Type | First implementation | Configuration and limitations |
| --- | --- | --- |
| FiveM server | Name, current players/capacity, availability, last checked, user-clicked join link | Saved server profile with explicit address and optional public join link. Use fixed status endpoints, not arbitrary paths from messages. Unreachable or hidden status is not proof that the server is offline. |
| Minecraft server | Java server MOTD, version, players/capacity, reachability, copy address | Saved host/port profile; bounded direct server-list ping. No account login, RCON, player identity collection, or third-party submission of LAN addresses. Bedrock requires a separate protocol and is outside this first Java implementation. |
| Spotify track | Artwork, title, artist, album, open link; optional favorite timestamp | Fixed song reference remains fixed. Metadata via Spotify's supported API when configured. Annotation/timestamp must remain ordinary visible message text if not representable safely in existing marker grammar. |
| Spotify playlist | Artwork, title, description and available metadata; refresh changes | API access required. Item count, duration, and latest additions only where current API permissions actually provide them. Do not promise contents of arbitrary public playlists. |
| Spotify live listening | Follow the referenced Discord user's visible Spotify activity, artwork, track, artist, progress | Use Vencord's existing PresenceStore, without extracting account tokens. No visible activity means unavailable, not paused or definitely not listening. Never substitute the viewer's own playback. |
| Twitch channel | Live/offline, title, category, viewers, start time/uptime, watch link | User-supplied Twitch application credentials kept native; app token obtained and renewed natively. Distinguish a successful empty stream result from a request failure. |
| Steam game | Artwork/title, country-specific price and discount when obtainable, current players where supplied, store link | Country preference. Validate Store endpoint responses separately from the documented player-count API. Sale end countdown only if a trustworthy endpoint supplies the end time. Missing price does not mean free. |
| YouTube livestream | Scheduled/live/ended, title/channel, artwork, countdown, optional concurrent viewers, watch link | YouTube API key. Poll a supplied video ID, avoiding expensive channel searches. Hidden/missing viewer counts remain unknown. |
| X post | Text, author, timestamp, images, available quoted-post context, optional engagement, open link | Official X API credentials and an explicit paid-reads opt-in. No paid calls during development without authorization. Missing setup has a useful link fallback. Videos open at X in this version. |
| Service status | Named service, operational/degraded/outage/unknown, incident summary, checked time | Saved Statuspage-compatible source profiles with explicit addresses. No arbitrary health URLs from chat. |
| Dockhand | Selected environment/container or saved group: running/stopped, reported health, summary counts, checked time | Local profile with instance address, environment, allowed container selection and authentication. Read-only queries; no start/stop/restart/deploy buttons. Container running state is distinct from application health. |

## Settings and composer

Add a Connections panel accessible from the plugin settings, with sections for game servers, Dockhand/service status, and API integrations. Each profile has a stable generated ID, editable display name, provider-specific fields, Test Connection, Save and Remove. API integrations expose configured/missing/expired status and replace/remove secret inputs rather than revealing saved credentials.

Provider enable toggles remain ordinary plugin settings. Public preferences such as Steam country and artwork visibility can use the standard settings store. Connection secrets live separately under Vencord user data and use Electron safeStorage; require OS encryption availability rather than silently saving plaintext. Typed credentials necessarily pass through the setup form once, then are cleared. Saved secrets and embedded bridge credentials never come back to card renderers.

The composer accepts supported public links and offers saved-profile selectors for local services and game servers. Spotify has explicit Track, Playlist, and Follow listening choices. Preview and insertion use the same registry entries as message rendering. Insert changes only the current draft; the user sends the message. Local profiles never auto-include private addresses in the fallback text.

Markers contain canonical public resource IDs or an opaque saved-profile ID. Names are presentation, not lookup identities. Profiles imported on another client must be configured explicitly; matching a display name never silently binds a remote message to a different local service.

## Native requests, storage and refresh

New local profile requests run through the native connection layer and fixed provider operations. Profile configuration is not accepted through public card HTTP routes. Validate every native input as well as composer input. Credential-bearing HTTP requests must not follow redirects or send secrets to response-supplied URLs. Keep TLS verification enabled; any support for a private certificate must be scoped to that saved connection and explicit.

Changing a profile's provider, origin, host, port or TLS policy clears its credentials and requires re-entry. Persist profile data atomically, version its format, and refuse to overwrite malformed existing storage. Native read operations return only public configuration and hasCredential. Dockhand resolves only explicitly configured LAN/loopback destinations, checking DNS at connection time. Credential-free game profiles can explicitly name public servers as well as local servers; messages never select a new destination. Public API providers use compiled HTTPS origin allowlists.

Use bounded response bodies, deadlines, strict schemas and allowlisted artwork hosts. Direct Minecraft connections need a packet/response byte limit and total timeout. Remote content stays plain text; no remote HTML, executable embeds or permissive CSP changes. Register only required image hosts before the Discord document loads.

Preserve shared five-second manual cooldown, in-flight deduplication, deferred retries and rate-limit backoff. Provider TTLs should reflect data: short for game/live status, longer for catalog data, and conservative for billed X reads. X paid reads need a configured request budget in addition to explicit enablement; disable background X refresh by default. Only mounted cards should cause active polling. Progress bars/countdowns advance locally from timestamps rather than making per-second API requests.

Connection changes invalidate the associated cached data and pending work so an old response cannot repopulate a replaced profile. Never persist raw API responses, credentials, environment variables, logs, container labels or Docker connection details. Persist only validated public card data; keep authenticated/local status in memory initially. Stable and Dev must have separate credentials, profiles and caches.

## Implementation sequence and file boundaries

1. Native profile/secret storage and settings UI. Extend native.ts and bridge/managed.mjs through narrowly typed configuration interfaces. Add fixed provider request helpers instead of growing arbitrary URL transport.
2. FiveM, Minecraft, service status and Dockhand adapters plus renderers and profile composer selections.
3. Spotify track/playlist adapters and a separate presence-driven listening renderer.
4. Twitch, Steam, YouTube and X adapters and renderers.
5. Consolidate composer provider selection through registry metadata; preserve existing marker compatibility and preview behavior. Update types.ts, validation.ts, marker.ts, polling.ts and index.tsx only as their contracts require.
6. Tests, isolated Dev build/typecheck, packaging verification and setup documentation. Review the completed security-sensitive connection changes independently before installation.

Each adapter gets its own small module under the distributable plugin source. The existing bridge/runtime.mjs remains the canonical bridge and delegates provider-specific work. Root bridge/server.mjs stays a wrapper. Avoid a plugin framework rewrite or new production dependencies unless a protocol requires one and there is a concrete justification.

## Acceptance and validation

- Every new type can be selected/parsed, previewed, inserted and rendered, or shows a specific setup requirement. A setup shell alone is not a completed provider.
- Fixture-test the meaningful provider state transitions and malformed/missing data. Add one focused regression per distinct boundary, not a matrix of duplicate UI tests.
- Negative tests cover message-controlled destinations, redirect credential leakage, invalid profile identifiers, credential readback, cache isolation, revocation during an in-flight request, destination-change credential invalidation and encrypted-storage failure without overwriting prior data.
- Dockhand fixtures must distinguish empty/unknown results from healthy status: its current list route may return an empty array on connection errors.
- Spotify tests must show that one user's marker never resolves to another user's playback, and expired/missing activity stops progress.
- Verify composer/marker compatibility, existing provider tests and stable/Dev identity generation.
- Run node --test tests/*.test.mjs after integration, then node scripts/build.mjs --dev-plugin with VENCORD_PATH set. Package source after build verification. Report actual observed results.
- Live authenticated checks require locally configured credentials; do not ask the user to paste secrets into chat. Dockhand's installed version/auth mode and reachable address are still needed for a real instance smoke test.
- User performs visible Discord checks; no computer use, automated Discord messages, or unannounced restarts. No stable promotion, commits, pushes, releases, service changes or installation are authorized by this design document.

## Risk and recovery

The main risks are private network requests triggered by messages, secrets escaping the native process, paid API polling, stale authenticated data after configuration changes, and provider APIs with version-dependent fields. Use explicit saved destinations, native-only secret storage, opt-in billed reads, connection-scoped cache invalidation, and unknown/unavailable states.

Independent Sol design review recommended this native-owned profile approach, including fail-closed encryption, fixed operations, secret-clearing destination updates, bounded responses and negative boundary tests. That is a design verdict, not a review of implemented code. A final independent critical review remains required after implementation.

Develop in the isolated Dev identity. Disable an individual provider or remove its profile to stop its requests. Disabling the plugin cancels new provider polling and closes owned connections. Existing stable installation remains a fallback until an installation is separately authorized. Surface sanitized connection failures and last-success timestamps without logging responses or credentials.

## Evidence and outstanding compatibility checks

- [Dockhand manual](https://dockhand.pro/manual/) and [container API source](https://github.com/Finsys/dockhand/blob/main/src/routes/api/containers/%2Bserver.ts): environment-scoped container reads, authentication and empty-result ambiguity. [Login route](https://github.com/Finsys/dockhand/blob/main/src/routes/api/auth/login/%2Bserver.ts) uses a session cookie and supports MFA; verify compatibility with the user's installed version. Initial supported setup: explicit native local login/MFA with an encrypted stored session; expired sessions require reconnect. Do not scrape browser sessions or bypass SSO.
- [Spotify changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026): playlist contents are restricted; metadata-only results are valid. Local Vencord exports PresenceStore and existing plugins call getActivities(userId), supporting the proposed presence-based listening path. Live verification remains necessary.
- [Twitch Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams): requires an app or user access token.
- [YouTube video resource](https://developers.google.com/youtube/v3/docs/videos#liveStreamingDetails): scheduled/actual times and optional concurrent viewers.
- [Steam player-count API](https://partner.steamgames.com/doc/webapi/ISteamUserStats#GetNumberOfCurrentPlayers): documented live player count. Store pricing and sale deadlines remain compatibility checks; the attempted web-tool Store request did not return usable data.
- [X pricing](https://docs.x.com/x-api/getting-started/pricing): reads are billed; no automatic paid polling by default.
- [Cfx server commands](https://docs.fivem.net/docs/server-manual/server-commands/): status endpoints can be restricted by server configuration. Verify direct status response fixtures during implementation.
