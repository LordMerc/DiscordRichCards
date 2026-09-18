# Music, streams, games and service cards

Open **Vencord Settings → Plugins → DiscordRichCards → Connections**. Add a named connection, enter its settings and click **Save**. **Test connection** uses saved configuration. For API integrations it checks required settings; use a card preview to verify actual API access. Enter credentials only in this local panel, never in a Discord message.

Use **Create RichCard** beside the chat box. Choose **Public link**, **Saved server or service**, or **Follow my Spotify listening**, preview, then insert into the draft. You send the message. Live rendering requires the plugin; public links can be included as fallback text.

## Supported connections

| Provider | Setup | Card contents |
| --- | --- | --- |
| FiveM | HTTP(S) server origin, e.g. `http://server.example:30120`; optional cfx.re join link | Name, players/capacity, join link. Server status endpoints must be available. |
| Minecraft | Java host and port (default 25565) | MOTD, version, players, copy address. Direct Java ping; no Bedrock/RCON/SRV discovery. |
| Dockhand | Local origin, numeric environment ID, exact comma-separated container names, local login | Selected running/healthy counts, stopped/degraded/unknown state. Running alone is not healthy. |
| Statuspage | Compatible origin, e.g. `https://www.githubstatus.com` | Service status, incident count and up to three incident titles. |
| Spotify catalog | Developer application client ID and client secret | Track or playlist metadata/artwork and open link. Development-mode restrictions apply. |
| Spotify listening | Connect Spotify to Discord and share listening activity; no API setup | Follows the referenced user's visible Discord presence; absent/expired activity is unavailable. |
| Twitch | Developer application client ID and client secret | Live/offline, title, category, viewers, uptime. |
| Steam | Optional two-letter country setting (default US) | Region-specific price/discount or explicit free-to-play status, current players when available. |
| YouTube | API key with YouTube Data API v3 enabled | Title/channel, scheduled/live/ended state, countdown/uptime and available viewers. |
| X | API bearer token, **Allow paid X API reads**, hourly request cap | Post text, author/time, first photo, available quoted text and likes. Reads may cost money. |

Paste ordinary HTTPS public links into the composer. YouTube watch/live/youtu.be links and X/twitter.com status links are supported. Spotify track/playlist references stay fixed; Follow listening changes with your visible activity. Add favorite-song timestamps and comments as ordinary message text.

## Dockhand and local profiles

Save the address, environment and container names. If Dockhand has authentication disabled, use **Test connection** directly; no credentials are needed. For authenticated instances, use **Connect Dockhand** with local username/password and MFA if enabled. Only the returned session is saved; passwords and codes are cleared. Expired sessions require reconnecting. This version supports local login/MFA and unauthenticated instances, not SSO-only instances. It does not read browser cookies or change authentication settings. A saved session is always used when present; authentication errors are never retried anonymously. Use **Disconnect** to clear an old saved session if you have disabled authentication on your instance.

Use your environment's numeric ID. The adapter calls `GET /api/containers?env=...`; verify compatibility with your installed Dockhand version. Empty results do not prove health. Confirm the environment and exact container names if selections are missing.

Dockhand must resolve to a private/loopback address from the Discord computer. It has no public relay, container controls, log access or Docker socket connection. TLS verification remains enabled; use a trusted certificate for private HTTPS. The legacy bridge's self-signed-certificate setting does not apply here.

Each selected container shows its name, image, state, uptime/status, creation time when supplied, and recorded update availability. The card reads `/api/containers/pending-updates`; it never triggers update scans or installs updates. **Created** is the container creation time, not a proven last-deployment time. **Update checked** is the recorded pending-update check time. **No pending update reported** does not guarantee the image is current; **Update status unavailable** means the metadata could not be read. The footer's **Checked** time is when the card last fetched status.

Saved-service markers contain generated profile IDs, not addresses or credentials. Profiles are device-local. Other viewers cannot resolve your saved profile merely by receiving the marker, even on the same network. This release has no profile import/synchronization or public status publisher; another viewer can create a card from their own configured profile.

## API limitations

Spotify catalog uses application client credentials. Playlist cards show only metadata/counts returned by the API; full contents, latest additions and total duration are not promised in this release. Live listening reads visible presence, never Spotify account tokens. It cannot distinguish paused playback from hidden activity.

Steam sale deadlines are not guessed. Missing prices or YouTube viewer counts remain unknown, not zero. Twitch/Spotify application tokens renew in native memory as their lifetime expires. Setup errors retain a public open-link fallback.

X makes a paid request only after manual **Refresh**, with paid reads enabled and remaining request budget. Background polling spends no X credits. The rolling hourly cap counts attempted post requests, not currency or returned resources, and survives plugin/Discord restarts. Configure spending limits in the X developer console too. Videos open at X.

## Storage, refresh and recovery

Credentials live separately in `Vencord/discord-richcards/connections.json`, encrypted with OS-backed Electron safeStorage. Unavailable secure storage, including Linux `basic_text`, fails closed. Native readback provides only profile settings and a credential-present flag. Use **Clear credential** or Dockhand **Disconnect** to remove a credential while keeping its profile/marker; removing the profile removes both. Configuration changes clear old credentials unless replacements are supplied; reconnect after changing Dockhand selections. Corrupt storage is preserved instead of overwritten. The file also stores paid X request timestamps for its restart-safe budget, never response data.

New providers always use the native built-in bridge, even when external mode is enabled for GitHub/Roblox/Codex. Hermes keeps its external setup. New card data is memory-only. Profile mutations invalidate old results. Dev has separate profiles, credentials and cache.

Mounted status/stream cards refresh about every 30 seconds; Spotify catalog and Steam cache five minutes. Manual refresh has a five-second gate; upstream rate limits back off at least one minute. Failed refreshes retain last successful data with a warning; changed/removed profiles clear data. X uses the separate manual-read rule.

New artwork requires image-only CSP registrations. Fully restart Discord after installing native/CSP changes. Builds do not verify visible rendering. Disable a provider or plugin to stop its mounted-card polling. Building does not install or restart Discord.
