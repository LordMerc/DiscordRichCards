# Card Expansion Implementation Plan

> Execution: subagent-driven-development with disjoint ownership; parent integrates and verifies. No commits or installation without authorization.

Goal: implement the approved CARD-EXPANSION-DESIGN.md in the canonical plugin.
Architecture: native encrypted profiles supply fixed provider adapters; existing bridge, registry, refresh and composer remain the shared paths. Spotify listening uses Discord presence.
Tech stack: existing TypeScript/React, Electron and Node built-ins; no added production dependencies.

## Interfaces and ownership

- Parent owns native.ts, bridge/managed.mjs, bridge/connections.mjs, bridge/transport.mjs, bridge/minecraft.mjs, native connection tests and documentation.
- Provider implementer owns bridge/expanded.mjs and provider modules, bridge/runtime.mjs, tests/expanded.test.mjs.
- UI implementer owns frontend .ts/.tsx/styles excluding native.ts, tests/expanded-client.test.mjs and related composer tests.
- No worker spawns agents. Preserve other edits. Canonical source only; stable installation stays unchanged.

## Task 1: Native profiles and bounded transports

- [x] Write tests for encryption unavailable/corrupt file, secret-free readback, destination-change invalidation and unknown-profile lookup. Run node --test tests/connections.test.mjs and observe missing implementation failure.
- [x] Implement createConnectionStore({file,encrypt,decrypt,isEncryptionAvailable}) returning list(), save(input), remove(id), get(id), integration(provider), revision. Profiles: {id,provider,name,config,secret?}; secret is a string-keyed string record, exposed only to native callers. Public list omits secret and includes hasCredential.
- [x] Implement bounded requestJson(url,{method?,headers?,body?,localOnly?,signal?}) with fixed caller-selected URL, no redirects, max 1 MiB, 8s deadline and normalized errors. Result {status,data,headers}; credentials never appear in errors. request target config is validated before use.
- [x] Implement minecraftStatus({host,port}) as bounded Java status ping; direct protocol only, no account auth.
- [x] Native methods listConnections(), saveConnection(input), removeConnection(id), testConnection(id), connectDockhand(id,username,password,mfaToken). Return {ok,data?,error?}; session captured/stored natively. Pass providerOptions into managed bridge.

## Task 2: Providers

- [x] Write fixture tests then implement createExpandedResolver(options), with supports(provider,kind), resolve(card,forceRefresh), invalidate(), close(). options: getProfile(id), getIntegration(provider), getRevision(), requestJson(url,options), minecraftStatus(config), now(). All may be injected. getProfile/getIntegration return native profile or null synchronously.
- [x] Return existing version-1 envelope with normalized SummaryCard data {title,subtitle?,description?,status,statusLabel,fields:[{label,value}],url?,imageUrl?,startedAt?,endsAt?,copyText?}; status is online/offline/live/scheduled/ended/healthy/degraded/outage/unknown/info.
- [x] Implement fivem:server, minecraft:server, dockhand:status, statuspage:status using profile ID; spotify:track/playlist using 22-character ID; twitch:channel using login; steam:game using positive app ID; youtube:live using video ID; x:post using numeric post ID.
- [x] Add runtime delegation and managed lifecycle invalidation. No credentials in persisted card cache. Backoff, dedup, revision invalidation and five-second manual gate apply.
- [x] Run node --test tests/expanded.test.mjs with mocked upstream responses, including malformed and rate-limit responses and local empty ambiguity.

## Task 3: UI and composer

- [x] Extend parseComposerLink/validation first with focused failing tests and run node --test tests/expanded-client.test.mjs.
- [x] Implement summary renderer with artwork fallback, status, metrics, timestamp, links and shared Refresh; specialized Spotify presence renderer with user ID marker and safe expiry.
- [x] Add Connections panel through plugin settingsAboutComponent; native methods above, masked replacement secrets, save/test/remove, Dockhand login form. Config fields: FiveM baseUrl/joinUrl; Minecraft host/port; Dockhand baseUrl/environmentId/containerNames; Statuspage baseUrl; Twitch clientId; Spotify clientId; YouTube no config; X allowPaidReads/maxRequestsPerHour; Steam country. Secrets: clientSecret for Twitch/Spotify, apiKey for YouTube, bearerToken for X, session for Dockhand set by native login only.
- [x] Integrate registry-driven previews and profile selector plus Follow listening (current Discord user ID); preserve draft-only insertion and existing markers. New API providers show useful setup state until configured.
- [x] Run focused tests and ensure new artwork hosts are communicated to parent for image-only CSP.

## Task 4: Integration and independent critical review

- [x] Run node --test tests/*.test.mjs; fix only concrete failures and add a regression for distinct defects.
- [x] Run $env:VENCORD_PATH='C:\Users\brand\Vencord'; node scripts/build.mjs --dev-plugin, then package source with scripts/package.ps1.
- [x] Review full diff, independent security review of credentials/request boundaries and frontend contract. Resolve findings before completion.
- [x] Update PROTOCOL.md, README and validation record. Mark live provider checks requiring user credentials or Discord inspection as unverified. No paid API requests, Discord messages, restarts or installed-source edits.
