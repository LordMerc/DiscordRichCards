# RichCards protocol v1

## Additional native providers

New provider/kind pairs: `fivem:server`, `minecraft:server`, `dockhand:status`, `statuspage:status`, `spotify:track`, `spotify:playlist`, `twitch:channel`, `steam:game`, `youtube:live`, `x:post`. The first four references are native saved-profile IDs. Public providers use canonical resource IDs; X IDs are decimal strings, never JavaScript numbers. `spotify:live:DISCORD_USER_ID` is a renderer-only presence subscription and makes no bridge request.

New bridge cards use the existing version-1 envelope with SummaryData: required text `title`, `statusLabel`, `status`, and `fields` (up to eight `{label,value}` string pairs). Optional fields: `subtitle`, `description`, allowlisted `url`/`imageUrl`, ISO `startedAt`/`endsAt`, and `copyText`. Status is `online | offline | live | scheduled | ended | healthy | degraded | outage | unknown | info`.

Expanded resolver data is memory-only and configuration-revision scoped. Normal cooldown/deferred-refresh/backoff fields remain applicable. X requires explicitly enabled paid reads and manual refresh; background resolution never spends credits. Local profile management is native IPC, not an HTTP API. Runtime embedders may supply `providerOptions` callbacks for native profiles, revision and bounded transport; X also requires a durable `consumeXRequest(limit, now)` reservation callback. Standalone defaults have no credential profiles. See the distributable [connection guide](vencord/discordRichCards/CONNECTIONS.md).

Every `/api/` request uses `Authorization: Bearer <bridge-token>` when configured. `/health` is a public health probe. The native client makes Node HTTP requests, not browser requests. Do not embed credentials in a marker or URL.

## Resolve a card

`GET /api/cards/:provider/:kind/:reference`

Encode the entire reference as one URL segment:

```text
/api/cards/github/pr/Vendicated%2FVencord%234607
/api/cards/hermes/session/demo-001
/api/cards/roblox/game/129932912185311
```

Optional `?refresh=1` bypasses normal cache TTL. Repeated manual upstream requests within five seconds return cached data with `refreshDeferredMs`; the client keeps Refresh pending and retries after that delay. Backoff still takes precedence.

```json
{
  "version": 1,
  "key": "github:pr:Vendicated/Vencord#4607",
  "provider": "github",
  "kind": "pr",
  "fetchedAt": "2026-09-18T02:00:00.000Z",
  "refreshAfterMs": 30000,
  "data": {}
}
```

`data` uses the renderer's own schema: `HermesSessionState`, `GitHubPR` or `RobloxGame` in the client source. The client validates payloads before rendering, bounds refresh intervals and has a 10-second native request deadline. Polls run sequentially and clean up on unmount. No component memory is authoritative.

During upstream failure, a successful persisted cache entry can be returned with `stale: true` and a safe `warning` string. The client shows the cached data with that warning, including after remounting. GitHub requests have an 8-second deadline; backoff also applies when no successful cache exists.

The built-in bridge is native-process-owned and uses a random loopback port and random bearer token. Native IPC methods start/stop it and resolve cards without returning the token or port to React. Its cache is isolated in Vencord user data. The external HTTP protocol remains available for Hermes and optional external GitHub mode.

## Legacy Hermes API

Preserved routes:

```text
GET /api/sessions
GET|PUT|PATCH|DELETE /api/sessions/:sessionId
POST /api/sessions/:sessionId/actions
GET /api/sessions/:sessionId/actions?after=<id>
```

Action body: `{ "action": "pause" }`, `resume` or `cancel`. Actions remain queued for the publisher to consume. GitHub's only bridge operation is a read; Open PR uses a validated GitHub link locally.

The JSON store retains `sessions`, `actions`, `nextActionId` and adds `cards` for normalized provider cache entries. Writes use a temporary file and rename. Run one bridge process per data file. Missing files initialize a new store; unreadable/corrupt files must be repaired or restored before startup.

Errors use `{ "error": "human-readable message" }` with HTTP 400 (input), 401 (auth), 403 (browser origin), 404 (missing/unsupported), 429 (rate limit), or 5xx (upstream/storage failure). Secrets and raw upstream exceptions are excluded.

## Add a renderer/provider

Client `registerRenderer` takes provider, kind, reference validator, enabled callback and React component. Shared `useCard` handles fetching and recovery; `CardShell` supplies the preserved visual baseline. Add a corresponding bridge resolver and provider-specific validation/cache policy. Never fetch an arbitrary URL supplied by message text.

## Roblox game data

`roblox:game` uses a canonical positive safe-integer **place ID**, not a universe ID or arbitrary URL. The bridge resolves the universe using the fixed Roblox API origins. It sends no GitHub token or Roblox credentials. Successful data includes numeric `placeId`/`universeId`, string `name`/`creator`/`updatedAt`/`statusReason`, nullable nonnegative integer `playing`/`favorites`/`visits`, and `status`: `open | private | locked | unknown`. See README for availability semantics. The read-only provider uses a 30-second cache and the same manual-refresh envelope fields.

Roblox data may additionally contain nullable `iconUrl` and `thumbnailUrl` fields. Older persisted cards without these fields remain valid. Both the bridge and renderer accept only HTTPS URLs on Roblox's `rbxcdn.com` CDN (no credentials or nondefault port). Artwork retrieval is optional and has a two-second budget within the overall request deadline; its failure does not fail the stats card.

Optional event fields are `events` (array), `eventsStatus` (`ready | stale | unavailable`) and `eventsTruncated` (boolean). Each event contains a decimal-string `id` (Roblox event IDs exceed JavaScript safe integers), a `title`, and ISO timestamps `startsAt`/`endsAt`. Older cards without these fields remain valid. Only public active records for the requested universe are accepted; event times determine live/upcoming/ended state. Clients must remove ended entries as time passes, even with cached data. `ready` with an empty array means no matching events in the fetched pages; `unavailable` means no successful event fetch; `stale` means the last refresh failed. `eventsTruncated` signals a pagination cap. Events have an independent five-minute TTL, a two-second total request budget and one-minute failure backoff; manual refresh bypasses TTL but respects backoff.

## Codex reset status

`GET /api/cards/codex/reset/today` resolves the fixed public endpoint `https://hascodexratelimitreset.today/api/status`. No other reference is accepted and redirects are rejected. It uses the same envelope and manual refresh semantics as other providers, with a 30-second TTL and an eight-second request deadline.

Data fields: `state` (`yes`, `no`, `unknown`), `monitor` (`active`, `inactive`, `unknown`), nullable ISO `checkedAt` and `resetAt`, `tweetText`, nullable validated `tweetUrl`, and `rationale`. Source check time is independent of envelope fetch time. Missing status is an upstream error; unfamiliar status is `unknown`. Upstream diagnostic errors are not included. Only HTTPS X/Twitter status links are retained. Failed refreshes retain the last successful data; backoff is 30 seconds, or 60 seconds for HTTP 429.
