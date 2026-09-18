import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

export const Native = VencordNative.pluginHelpers.DiscordRichCards as PluginNative<typeof import("./native")>;
export const settings = definePluginSettings({
    useExternalBridge: { type: OptionType.BOOLEAN, description: "Use an external bridge for GitHub and Roblox instead of the automatic built-in bridge", default: false, restartNeeded: true },
    bridgeUrl: { type: OptionType.STRING, description: "External bridge URL (for Hermes, or GitHub/Roblox when external mode is enabled)", default: "http://127.0.0.1:8787" },
    authToken: { type: OptionType.STRING, description: "Bridge bearer token (not your GitHub token)", default: "" },
    botUserIds: { type: OptionType.STRING, description: "Allowed Discord author IDs, comma-separated. Empty allows all authors.", default: "" },
    pollIntervalMs: { type: OptionType.NUMBER, description: "Hermes refresh interval in milliseconds (minimum 500)", default: 1000 },
    acceptSelfSigned: { type: OptionType.BOOLEAN, description: "Accept self-signed HTTPS certificates for a bridge you control", default: false },
    debug: { type: OptionType.BOOLEAN, description: "Log card selection and request status without credentials", default: false },
    enableHermes: { type: OptionType.BOOLEAN, description: "Enable Hermes cards using your external bridge and publisher", default: true },
    enableRoblox: { type: OptionType.BOOLEAN, description: "Enable Roblox game cards", default: true },
    enableGitHub: { type: OptionType.BOOLEAN, description: "Enable GitHub PR cards", default: true }
});

export function debug(event: string, detail: string | number) {
    if (settings.store.debug) console.debug("[DiscordRichCards]", event, detail);
}
