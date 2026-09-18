# RichCards protocol v1

Every `/api/` request uses `Authorization: Bearer <bridge-token>` when configured. `/health` is a public health probe. The native client makes Node HTTP requests, not browser requests. Do not embed credentials in a marker or URL.

## Resolve a card

`GET /api/cards/:provider/:kind/:reference`

Encode the entire reference as one URL segment:

```text
/api/cards/github/pr/Vendicated%2FVencord%234607
/api/cards/hermes/session/demo-001
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

`data` uses the renderer's own schema: `HermesSessionState` or `GitHubPR` in the client source. The client validates payloads before rendering, bounds refresh intervals and has a 10-second native request deadline. Polls run sequentially and clean up on unmount. No component memory is authoritative.

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
