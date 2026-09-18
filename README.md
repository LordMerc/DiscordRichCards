# Discord RichCards

Live cards anchored to ordinary Discord messages. The Vencord plugin re-fetches authoritative bridge state whenever an anchor remounts. Hermes retains its installed high-contrast stylesheet, animations, activity details and pause/resume/cancel controls. GitHub PR and Roblox game cards are read-only.

Public GitHub and Roblox cards work as soon as the plugin is enabled in desktop Vencord. The plugin runs its built-in bridge inside Discord, starts it automatically, and stops it when disabled or when Discord exits. No separate Node installation, bridge terminal, URL or token is required for public cards. Vencord custom plugins still require copying the plugin source into a Vencord checkout and building it.

The built-in bridge uses a random loopback port and a fresh private bearer token for each run. Its cache persists under `Vencord/discord-richcards/cards.json` in your user-data directory. The port and token stay in the native process. Optional GitHub credentials use `RICHCARDS_GITHUB_TOKEN` in Discord's environment; see `GITHUB.md`.

## Optional external bridge / Hermes setup

Hermes needs an external bridge and publisher. Public GitHub and Roblox cards do not need this section. Enable **Use an external bridge for GitHub and Roblox** only if you deliberately want their requests handled by your own server. External mode and Hermes use the existing Bridge URL, bearer token and TLS settings.

Stop the old bridge before starting this one on the same port. Use the existing data file to retain your Hermes sessions; do not run both processes against that file. Back it up first while the old bridge is stopped.

```powershell
# Run from the cloned DiscordRichCards repository.
$env:RICHCARDS_TOKEN = Read-Host 'Bridge token'
# Optional: set RICHCARDS_DATA to an existing Hermes data file to preserve sessions.
node .\bridge\server.mjs
```

The default address is `http://127.0.0.1:8787`. Existing `HERMES_LIVE_HOST`, `HERMES_LIVE_PORT`, `HERMES_LIVE_TOKEN` and `HERMES_LIVE_DATA` are supported; `RICHCARDS_*` takes precedence. The default data file is `bridge/hermes-live-data.json`. Browser-origin requests are rejected; use the native plugin or HTTP clients. Tokenless mode is supported only on loopback without a GitHub token. Non-loopback binding or a GitHub token requires a bridge token.

## Build and install

The complete source is in `vencord/discordRichCards`, including the bridge. Copy the entire folder. Enable **DiscordRichCards** after building and restarting Discord. Disable HermesLive to avoid duplicate Hermes cards; if you use Hermes, copy its external bridge settings into DiscordRichCards. Public GitHub and Roblox need no settings.

```powershell
# Run from the cloned DiscordRichCards repository.
node --test tests/*.test.mjs
node scripts/build.mjs
# The command above validates an isolated Vencord copy under .build.
# To install the plugin into your working checkout:
$vencord = if ($env:VENCORD_PATH) { $env:VENCORD_PATH } else { Join-Path $env:USERPROFILE 'Vencord' }
$pluginDestination = Join-Path $vencord 'src\userplugins\discordRichCards'
New-Item -ItemType Directory -Force -Path $pluginDestination | Out-Null
Get-ChildItem .\vencord\discordRichCards | Copy-Item -Destination $pluginDestination -Recurse -Force
Set-Location $vencord
pnpm build --dev
```

Fully quit Discord from its tray menu, relaunch it, and enable **DiscordRichCards** in Vencord. No reinjection is normally needed. `VENCORD_PATH` can select another checkout for isolated build verification.

To produce a distributable source ZIP on Windows, run `powershell -ExecutionPolicy Bypass -File scripts/package.ps1`. The archive is `dist/DiscordRichCards.zip`. This is a desktop Vencord custom plugin, not a Discord bot or a browser-extension plugin. Developers running the standalone bridge or tests need Node 24+; plugin users do not need Node to run cards after installation.

For rollback, disable DiscordRichCards and re-enable HermesLive. The legacy session API and persistence layout remain compatible; keep your data backup before migration.

## Try it

Send each anchor as a separate Discord message, with useful fallback text:

```text
PR review:
https://github.com/Vendicated/Vencord/pull/4608
[[richcard:github:pr:Vendicated/Vencord#4608]]
```

```text
Hermes Live Demo
[[hermes-live:demo-001]]
```

```text
Hermes Live Demo
[[richcard:hermes:session:demo-001]]
```

Run the demo in another terminal with the same bridge token:

```powershell
# Run from the cloned DiscordRichCards repository.
$env:RICHCARDS_TOKEN = Read-Host 'Bridge token'
$env:HERMES_LIVE_SESSION = 'demo-001'
node .\bridge\demo-publisher.mjs
```

The plugin leaves message text visible, allows one marker per message, and shows a clear notice if several markers are present. Discord may replace `:github:` with a custom emoji; both the plain marker and that emoji-formatted marker are recognized. Wrapping a marker in inline code also prevents emoji replacement. Invalid/unsupported markers show a compact error. GitHub checks and review summaries are deferred; v1 includes the primary PR details.

## Verify in Discord

Automated tests cover parsing, polling cleanup/re-entry scheduling, validation, bridge persistence, cache behavior and provider errors. They cannot prove Discord navigation or its installed UI.

1. Confirm the Hermes demo animates and its actions work with each marker syntax.
2. Confirm the GitHub card is readable and its Open PR and Refresh controls work.
3. Leave the channel and return; then restart Discord and return. Both cards should fetch again.
4. Stop/restart the bridge. Cards should show an error during the outage and recover automatically.
5. Try an invalid PR reference, missing PR, and wrong bridge token. The normal message must remain visible.

See `PROTOCOL.md` for integration details and `GITHUB.md` for credentials and refresh behavior.


## Author

[LordMerc](https://github.com/LordMerc) · Discord ID: `326081760108740608`

## Roblox game cards

Use the place ID from a Roblox game URL:

```text
https://www.roblox.com/games/129932912185311/Anime-Origins
[[richcard:roblox:game:129932912185311]]
```

Cards show playing now, favorites, visits, creator and public availability. Counts refresh every 30 seconds while visible; Refresh requests fresh data immediately, with a five-second repeat gate. Roblox may itself cache counters. Unavailable counts show an em dash, never a fabricated zero.

An optional **Events** section below the stats shows public live and upcoming Roblox events, with local start/end times. Live events appear first; three are shown initially and **More events** expands the remainder. Ended, cancelled and private events are excluded. A successful empty result hides the section; retrieval failures show an unavailable or stale-schedule notice without failing the game stats.

Events use the public virtual-events endpoint without credentials. They cache for five minutes; manual Refresh bypasses that TTL, but failed requests back off for one minute. Pagination shares a two-second budget and stops after five pages; a notice indicates when more pages exist. Schedule labels update every 30 seconds while mounted, including during an outage.

For code-based card extensions, compose optional feature components between the card body and footer using `components/CardSection.tsx`. `renderers/roblox/RobloxEventsSection.tsx` is the first example. Keep each feature's data optional in the provider schema, validate it in `validation.ts`, and isolate optional fetch failures from the main card. This is component composition, with no runtime extension loader or user-authored scripts.

Availability uses public universe metadata: **Open** means public and active; **Private** means Roblox explicitly reports private; **Locked** means archived or inactive. Locked does not necessarily mean moderated. **Unknown** means Roblox did not provide enough information. This is not a guarantee that a particular account, age group, region or device can join. No Roblox login, cookie or Studio connection is used. A guest sign-in requirement is not treated as a private game.

Sources: [Roblox Games API](https://create.roblox.com/docs/cloud/reference/domains/games) and [universe API reference](https://create.roblox.com/docs/cloud/reference/features/universes). The public Develop endpoint is experimental and may change.

## Development plugin alongside stable

Run these from the feature worktree:

```powershell
node --test tests/*.test.mjs
node scripts/build.mjs --dev-plugin
node scripts/dev-plugin.mjs --install
$vencord = if ($env:VENCORD_PATH) { $env:VENCORD_PATH } else { Join-Path $env:USERPROFILE 'Vencord' }
Push-Location $vencord
pnpm build --dev
Pop-Location
```

Fully restart Discord, then enable **DiscordRichCardsDev**. Stable **DiscordRichCards** can remain enabled. The generated dev plugin has independent settings, native helper, message accessory, styles and cache (`Vencord/discord-richcards-dev/cards.json`). It only recognizes `richcard-dev` markers and ignores legacy Hermes anchors. Example:

```text
[[richcard-dev:roblox:game:129932912185311]]
```

Edit the worktree source, then regenerate, rebuild and restart for each native change. Do not edit the generated installed dev folder. Disable DiscordRichCardsDev to stop development cards and its bridge; stable settings and data remain intact. Publishing the GitHub repository does not require reinstalling or replacing a matching stable plugin.

### Artwork and Refresh controls

Roblox cards display the game icon and the first thumbnail behind a dark overlay. Images come from [Roblox's public Thumbnails API](https://create.roblox.com/docs/cloud/reference/features/thumbnails); only completed HTTPS Roblox CDN images are accepted. Artwork is cached for five minutes (missing or failed artwork retries after one minute), independently of live stats. Missing or broken images fall back to the plain card.

All card types—Roblox, GitHub and Hermes—use the same five-second manual Refresh button cooldown, counted from the click, with a visible countdown. Failed or fast requests do not bypass it; requests lasting longer keep the button disabled until finished. Automatic polling continues on its normal schedule. These shared changes are currently installed in the development variant; the stable installed plugin is unchanged pending feature integration.

The native plugin registers an image-only content-security-policy allowance for Roblox's HTTPS CDN through Vencord's supported `CspPolicies` API. A full Discord restart is required after first installing this change. It does not enable CDN scripts or renderer API connections.

The plugin's info dialog includes a GitHub repository button below Authors. Vencord reserves its header source/website row for built-in plugins; custom plugins use `settingsAboutComponent` instead. In development, open **DiscordRichCardsDev** to see the updated info section; the link still points to the canonical DiscordRichCards repository.
