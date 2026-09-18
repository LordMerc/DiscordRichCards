# GitHub pull request provider

Marker: `[[richcard:github:pr:OWNER/REPO#NUMBER]]`.

Public repositories work without a GitHub token or any external bridge setup. The built-in bridge starts with DiscordRichCards. For private repositories or higher API limits, fully quit Discord and launch it from an environment with `RICHCARDS_GITHUB_TOKEN` set. The token stays out of Discord settings, markers and persisted normalized card data:

```powershell
$env:RICHCARDS_GITHUB_TOKEN = Read-Host 'GitHub token' -MaskInput
# Start Discord from this same terminal so it inherits the token.
# Windows Discord installation:
Start-Process "$env:LOCALAPPDATA\Discord\Update.exe" -ArgumentList '--processStart', 'Discord.exe'
```

`-MaskInput` requires PowerShell 7. The setting above applies to Discord launched from that terminal, not automatically to later sign-ins. Use a fine-grained token with read access to pull requests for the intended repositories. In external-bridge mode, set the GitHub token on the server instead and also set `RICHCARDS_TOKEN`. Everyone holding that external bearer token can resolve repositories accessible to its GitHub token; this is a single-trust-domain bridge, not a multi-user authorization service. Keep cache files private because PR titles and metadata may be private.

The provider calls only GitHub's pull-request GET endpoint. PR state, draft status, author, branches, labels, file count, additions/deletions, comments and updated time are normalized. GitHub documents the endpoint and permissions in [REST pull requests](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).

Open PRs refresh every 30 seconds; closed/merged PRs every 120 seconds. Clicking Refresh bypasses the normal cache and requests current data even immediately after an automatic poll. Repeated manual fetches are limited to one every five seconds; a queued refresh displays a notice and retries automatically when eligible. GitHub may still take a short time to reflect a merge in its API. Identical concurrent requests share an in-flight fetch, and ETags avoid downloading unchanged data. Error/rate-limit backoff remains in effect. See [GitHub conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate).

An inaccessible private repository and a nonexistent PR can both produce 404. Invalid credentials, rate limiting, network outages and malformed responses produce compact errors. Existing on-screen data remains visible with an error when a refresh fails. Re-entry fetches again; cached successful data survives bridge restart.

No approve, merge, close, assign, webhook or other GitHub mutation is implemented.
