# Discord RichCards

Live cards anchored to ordinary Discord messages. The Vencord plugin re-fetches authoritative bridge state whenever an anchor remounts. Hermes retains its installed high-contrast stylesheet, animations, activity details and pause/resume/cancel controls. GitHub PR cards are read-only.

Public GitHub cards work as soon as the plugin is enabled in desktop Vencord. The plugin runs its built-in bridge inside Discord, starts it automatically, and stops it when disabled or when Discord exits. No separate Node installation, bridge terminal, URL or token is required for public PRs. Vencord custom plugins still require copying the plugin source into a Vencord checkout and building it.

The built-in bridge uses a random loopback port and a fresh private bearer token for each run. Its cache persists under `Vencord/discord-richcards/cards.json` in your user-data directory. The port and token stay in the native process. Optional GitHub credentials use `RICHCARDS_GITHUB_TOKEN` in Discord's environment; see `GITHUB.md`.

## Optional external bridge / Hermes setup

Hermes needs an external bridge and publisher. Public GitHub cards do not need this section. Enable **Use an external bridge for GitHub** only if you deliberately want all GitHub requests handled by your own server. External mode and Hermes use the existing Bridge URL, bearer token and TLS settings.

Stop the old bridge before starting this one on the same port. Use the existing data file to retain your Hermes sessions; do not run both processes against that file. Back it up first while the old bridge is stopped.

```powershell
# Run from the cloned DiscordRichCards repository.
$env:RICHCARDS_TOKEN = Read-Host 'Bridge token'
# Optional: set RICHCARDS_DATA to an existing Hermes data file to preserve sessions.
node .\bridge\server.mjs
```

The default address is `http://127.0.0.1:8787`. Existing `HERMES_LIVE_HOST`, `HERMES_LIVE_PORT`, `HERMES_LIVE_TOKEN` and `HERMES_LIVE_DATA` are supported; `RICHCARDS_*` takes precedence. The default data file is `bridge/hermes-live-data.json`. Browser-origin requests are rejected; use the native plugin or HTTP clients. Tokenless mode is supported only on loopback without a GitHub token. Non-loopback binding or a GitHub token requires a bridge token.

## Build and install

The complete source is in `vencord/discordRichCards`, including the bridge. Copy the entire folder. Enable **DiscordRichCards** after building and restarting Discord. Disable HermesLive to avoid duplicate Hermes cards; if you use Hermes, copy its external bridge settings into DiscordRichCards. Public GitHub needs no settings.

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
