import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

export const Native = VencordNative.pluginHelpers.DiscordRichCards as PluginNative<typeof import("./native")>;
export const settings = definePluginSettings({
    useExternalBridge: { type: OptionType.BOOLEAN, description: "Use an external bridge for GitHub, Roblox and Codex instead of the automatic built-in bridge", default: false, restartNeeded: true },
    bridgeUrl: { type: OptionType.STRING, description: "External bridge URL (for Hermes, or GitHub/Roblox/Codex when external mode is enabled)", default: "http://127.0.0.1:8787" },
    authToken: { type: OptionType.STRING, description: "Bridge bearer token (not your GitHub token)", default: "" },
    botUserIds: { type: OptionType.STRING, description: "Allowed Discord author IDs, comma-separated. Empty allows all authors.", default: "" },
    pollIntervalMs: { type: OptionType.NUMBER, description: "Hermes refresh interval in milliseconds (minimum 500)", default: 1000 },
    acceptSelfSigned: { type: OptionType.BOOLEAN, description: "Accept self-signed HTTPS certificates for a bridge you control", default: false },
    debug: { type: OptionType.BOOLEAN, description: "Log card selection and request status without credentials", default: false },
    enableHermes: { type: OptionType.BOOLEAN, description: "Enable Hermes cards using your external bridge and publisher", default: true },
    enableRoblox: { type: OptionType.BOOLEAN, description: "Enable Roblox game cards", default: true },
    enableGitHub: { type: OptionType.BOOLEAN, description: "Enable GitHub PR cards", default: true },
    enableCodex: { type: OptionType.BOOLEAN, description: "Enable the community Codex rate-limit reset tracker card", default: true },
    enableFiveM: { type: OptionType.BOOLEAN, description: "Enable saved FiveM server cards", default: true },
    enableMinecraft: { type: OptionType.BOOLEAN, description: "Enable saved Minecraft Java server cards", default: true },
    enableDockhand: { type: OptionType.BOOLEAN, description: "Enable local-network Dockhand status cards", default: true },
    enableStatuspage: { type: OptionType.BOOLEAN, description: "Enable saved service status cards", default: true },
    enableSpotify: { type: OptionType.BOOLEAN, description: "Enable Spotify tracks, playlists and live listening cards", default: true },
    enableTwitch: { type: OptionType.BOOLEAN, description: "Enable Twitch channel cards", default: true },
    enableSteam: { type: OptionType.BOOLEAN, description: "Enable Steam game cards", default: true },
    enableYouTube: { type: OptionType.BOOLEAN, description: "Enable YouTube livestream cards", default: true },
    enableX: { type: OptionType.BOOLEAN, description: "Enable X post cards (paid reads also require explicit opt-in in Connections)", default: true }
});

export function expandedProviderEnabled(provider: string) {
    switch (provider) {
        case "fivem": return settings.store.enableFiveM;
        case "minecraft": return settings.store.enableMinecraft;
        case "dockhand": return settings.store.enableDockhand;
        case "statuspage": return settings.store.enableStatuspage;
        case "spotify": return settings.store.enableSpotify;
        case "twitch": return settings.store.enableTwitch;
        case "steam": return settings.store.enableSteam;
        case "youtube": return settings.store.enableYouTube;
        case "x": return settings.store.enableX;
        default: return false;
    }
}

export function debug(event: string, detail: string | number) {
    if (settings.store.debug) console.debug("[DiscordRichCards]", event, detail);
}
