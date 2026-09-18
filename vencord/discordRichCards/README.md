# DiscordRichCards for desktop Vencord

1. Copy this whole `discordRichCards` folder into `Vencord/src/userplugins/`.
2. Build Vencord with `pnpm build --dev` and fully restart Discord.
3. Enable **DiscordRichCards** in Vencord settings.
4. Send a message containing `[[richcard:github:pr:OWNER/REPO#NUMBER]]`.

Public PRs work with no setup: the local bridge is bundled and starts automatically inside Discord. It stops on plugin disable or Discord exit. Cache data survives restarts. Discord's custom-emoji substitution of `:github:` is supported; inline code also works.

Example: `[[richcard:github:pr:Vendicated/Vencord#4608]]`

GitHub is read-only. Refresh bypasses ordinary cached data; repeated refreshes may briefly queue. GitHub API rate limits still apply. Optional `RICHCARDS_GITHUB_TOKEN` must be supplied in Discord's environment before launch, never in messages.

Hermes is optional and still needs an external bridge/publisher. Its URL and token are configured in plugin settings. Legacy `[[hermes-live:ID]]` and generic `[[richcard:hermes:session:ID]]` markers work. Disable HermesLive if installed to avoid duplicate cards.

Enable **Use an external bridge for GitHub and Roblox** to use a separately hosted server instead of the built-in bridge. Restart Discord after changing that option.

Roblox: `[[richcard:roblox:game:129932912185311]]` shows player/favorite/visit counts every 30 seconds with no setup. Availability uses public metadata (open, private, archived/inactive as locked, or unknown); account-specific join restrictions cannot be determined. Missing counters show an em dash. The repository README includes the separate DiscordRichCardsDev workflow.
