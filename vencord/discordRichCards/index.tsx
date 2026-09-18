import "./styles.css";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { GithubButton } from "@components/settings/tabs/plugins/PluginModalButtons";
import { IconComponent } from "@utils/types";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu, openModal } from "@webpack/common";
import { CardError } from "./components/CardShell";
import { ComposerModal } from "./components/ComposerModal";
import { parseGitHubPRRef, parseMarkers, parseRobloxGameRef } from "./marker";
import { getRenderer, registerRenderer } from "./registry";
import { HermesCard } from "./renderers/hermes/HermesCard";
import { GitHubPRCard } from "./renderers/github/GitHubPRCard";
import { RobloxGameCard } from "./renderers/roblox/RobloxGameCard";
import { debug, Native, settings } from "./settings";

registerRenderer({ provider: "hermes", kind: "session", component: HermesCard, validateReference: ref => /^[A-Za-z0-9._:-]{1,128}$/.test(ref), enabled: () => settings.store.enableHermes });
registerRenderer({ provider: "github", kind: "pr", component: GitHubPRCard, validateReference: ref => parseGitHubPRRef(ref) !== null, enabled: () => settings.store.enableGitHub });

registerRenderer({ provider: "roblox", kind: "game", component: RobloxGameCard, validateReference: ref => parseRobloxGameRef(ref) !== null, enabled: () => settings.store.enableRoblox });

function RenderFailure() { return <CardError message="This RichCard could not be rendered. Reload the channel to retry." />; }

const RichCardComposerIcon: IconComponent = ({ height = 20, width = 20, className }) => <svg aria-hidden="true" role="img" width={width} height={height} className={className} viewBox="0 0 24 24">
    <path fill="currentColor" d="M5 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4v4l4-4h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm1 5h12v2H6V8Zm0 4h8v2H6v-2Z" />
    <path fill="currentColor" d="m17.1 20.9-2.8-2.8 1.4-1.4 1.4 1.4 3.5-3.5 1.4 1.4-4.9 4.9Z" />
</svg>;

function openComposer(channelId: string) {
    openModal(props => <ComposerModal {...props} channelId={channelId} />);
}

const ComposerButton: ChatBarButtonFactory = ({ channel, disabled, isMainChat }) => {
    if (disabled || !isMainChat) return null;
    return <ChatBarButton tooltip="Create RichCard" onClick={() => openComposer(channel.id)} buttonProps={{ "aria-haspopup": "dialog" }}>
        <RichCardComposerIcon />
    </ChatBarButton>;
};

const composerContextMenu: NavContextMenuPatchCallback = (children, context?: { channel?: { id?: string; }; channelId?: string; }) => {
    const channelId = context?.channel?.id ?? context?.channelId;
    if (!channelId) return;
    const group = findGroupChildrenByChildId("submit-button", children);
    if (!group) return;
    const index = group.findIndex(child => child?.props?.id === "submit-button");
    if (index < 0) return;
    group.splice(index, 0, <Menu.MenuItem id="discord-richcards-create" key="discord-richcards-create" label="Create RichCard" action={() => openComposer(channelId)} />);
};

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
    description: "Persistent live Hermes, GitHub pull request and Roblox game cards anchored to Discord messages.",
    authors: [{ name: "LordMerc", id: 326081760108740608n }],
    dependencies: ["MessageAccessoriesAPI"],
    settings,
    chatBarButton: { icon: RichCardComposerIcon, render: ComposerButton },
    contextMenus: { "textarea-context": composerContextMenu },
    settingsAboutComponent: () => <div className="rich-card-about">
        <GithubButton text="View source code" href="https://github.com/LordMerc/DiscordRichCards" />
        <a href="https://github.com/LordMerc/DiscordRichCards" target="_blank" rel="noreferrer">GitHub repository</a>
    </div>,
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
