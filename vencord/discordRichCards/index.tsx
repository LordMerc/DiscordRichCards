import "./styles.css";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { CardError } from "./components/CardShell";
import { parseGitHubPRRef, parseMarkers } from "./marker";
import { getRenderer, registerRenderer } from "./registry";
import { HermesCard } from "./renderers/hermes/HermesCard";
import { GitHubPRCard } from "./renderers/github/GitHubPRCard";
import { debug, Native, settings } from "./settings";

registerRenderer({ provider: "hermes", kind: "session", component: HermesCard, validateReference: ref => /^[A-Za-z0-9._:-]{1,128}$/.test(ref), enabled: () => settings.store.enableHermes });
registerRenderer({ provider: "github", kind: "pr", component: GitHubPRCard, validateReference: ref => parseGitHubPRRef(ref) !== null, enabled: () => settings.store.enableGitHub });

function RenderFailure() { return <CardError message="This RichCard could not be rendered. Reload the channel to retry." />; }

function renderAccessory(message: Message) {
    const allowed = settings.store.botUserIds.split(",").map(id => id.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(message.author.id)) return null;
    const markers = parseMarkers(message.content ?? "");
    if (!markers.length) return null;
    if (markers.length > 1) return <CardError message="Use one RichCard marker per message." />;
    const descriptor = markers[0];
    const renderer = getRenderer(descriptor);
    debug("marker detected", `${descriptor.provider}.${descriptor.kind}`);
    if (!renderer) return <CardError message={`Unsupported RichCard: ${descriptor.provider}.${descriptor.kind}`} />;
    if (!renderer.enabled()) return null;
    if (!renderer.validateReference(descriptor.reference)) return <CardError message={`Invalid ${descriptor.provider} reference: ${descriptor.reference}`} />;
    const Component = renderer.component;
    return <ErrorBoundary key={`${descriptor.provider}:${descriptor.kind}:${descriptor.reference}`} fallback={RenderFailure}><Component descriptor={descriptor} /></ErrorBoundary>;
}

export default definePlugin({
    name: "DiscordRichCards",
    description: "Persistent live Hermes and GitHub pull request cards anchored to Discord messages.",
    authors: [{ name: "LordMerc", id: 326081760108740608n }],
    dependencies: ["MessageAccessoriesAPI"],
    settings,
    start() {
        if (!settings.store.useExternalBridge) {
            void Native.startManagedBridge().then(result => {
                if (!result.ok) console.error("[DiscordRichCards]", result.error);
            }).catch(() => console.error("[DiscordRichCards] Could not start the built-in bridge."));
        }
        addMessageAccessory("DiscordRichCards", props => renderAccessory(props.message), 4);
    },
    stop() {
        removeMessageAccessory("DiscordRichCards");
        void Native.stopManagedBridge().catch(() => console.error("[DiscordRichCards] Could not stop the built-in bridge."));
    }
});
