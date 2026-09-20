import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { insertTextIntoChatInputBox } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { DraftStore, DraftType, Modal, SelectedChannelStore, showToast, TextInput, Toasts, UserStore, useEffect, useMemo, useState } from "@webpack/common";
import { buildComposerInsertion, parseComposerLink, parseMarkers } from "../marker";
import type { ComposerCard } from "../marker";
import type { PublicConnection } from "../native";
import { getRenderer } from "../registry";
import { Native, settings } from "../settings";
import { subscribeConnections } from "../connectionsUi";

function isOwnAuthorAllowed(botUserIds: string) {
    const allowed = botUserIds.split(",").map(id => id.trim()).filter(Boolean);
    const userId = UserStore.getCurrentUser()?.id;
    return !allowed.length || Boolean(userId && allowed.includes(userId));
}

interface ComposerNoticeState {
    source: string;
    profileError: string;
    link: string;
    card: ComposerCard | null;
    providerEnabled: boolean;
    hasExistingCard: boolean;
    ownAuthorAllowed: boolean;
}

function composerNotice({ source, profileError, link, card, providerEnabled, hasExistingCard, ownAuthorAllowed }: ComposerNoticeState): string | undefined {
    if (source === "profile" && profileError) return profileError;
    if (!card && source === "link" && link.trim()) return "Paste a supported GitHub, Roblox, Spotify, Twitch, Steam, YouTube, X or Codex tracker link.";
    if (card && !providerEnabled) return `${card.provider} cards are disabled in DiscordRichCards settings.`;
    if (hasExistingCard) return "This channel's draft already contains a RichCard marker. One card is allowed per message.";
    if (!ownAuthorAllowed) return "Your Allowed Discord author IDs setting excludes your account, so this card will not render for you.";
    return undefined;
}

export function ComposerModal({ channelId, ...modalProps }: RenderModalProps & { channelId: string; }) {
    const [link, setLink] = useState("");
    const [includeUrl, setIncludeUrl] = useState(true);
    const [source, setSource] = useState("link");
    const [profileId, setProfileId] = useState("");
    const [profiles, setProfiles] = useState<PublicConnection[]>([]);
    const [profileError, setProfileError] = useState("");
    const { botUserIds } = settings.use(["botUserIds", "enableGitHub", "enableRoblox", "enableCodex", "enableFiveM", "enableMinecraft", "enableDockhand", "enableStatuspage", "enableSpotify", "enableTwitch", "enableSteam", "enableYouTube", "enableX"]);
    useEffect(() => {
        let disposed = false;
        const reload = async () => {
            try {
                const result = await Native.listConnections();
                if (disposed) return;
                setProfiles((result.data ?? []).filter(p => ["fivem", "minecraft", "dockhand", "statuspage"].includes(p.provider)));
                setProfileError(result.ok ? "" : result.error ?? "Could not load connections");
            } catch { if (!disposed) setProfileError("Could not load connections"); }
        };
        void reload(); const unsubscribe = subscribeConnections(() => { void reload(); });
        return () => { disposed = true; unsubscribe(); };
    }, []);
    const card: ComposerCard | null = useMemo(() => {
        if (source === "link") return parseComposerLink(link);
        if (source === "listening") {
            const id = UserStore.getCurrentUser()?.id;
            return id ? { provider: "spotify", kind: "live", reference: id, url: "" } : null;
        }
        const profile = profiles.find(p => p.id === profileId);
        return profile ? { provider: profile.provider as ComposerCard["provider"], kind: ["fivem", "minecraft"].includes(profile.provider) ? "server" : "status", reference: profile.id, url: "" } : null;
    }, [source, link, profileId, profiles]);
    const renderer = card ? getRenderer({ ...card, rawMarker: "" }) : undefined;
    const providerEnabled = renderer?.enabled() ?? false;
    const descriptor = card && providerEnabled ? { ...card, rawMarker: "" } : null;
    const Preview = renderer?.component;
    const existingDraft = DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "";
    const hasExistingCard = parseMarkers(existingDraft).length > 0;
    const ownAuthorAllowed = isOwnAuthorAllowed(botUserIds);

    const insert = () => {
        if (!card || !providerEnabled) return;
        if (SelectedChannelStore.getChannelId() !== channelId) {
            showToast("The selected channel changed. Reopen Create RichCard from the intended chat.", Toasts.Type.FAILURE);
            return;
        }
        if (parseMarkers(DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "").length > 0) {
            showToast("This draft already contains a RichCard marker. Send it or remove the marker first.", Toasts.Type.FAILURE);
            return;
        }
        insertTextIntoChatInputBox(buildComposerInsertion(card, includeUrl));
        modalProps.onClose();
    };

    const notice = composerNotice({ source, profileError, link, card, providerEnabled, hasExistingCard, ownAuthorAllowed });

    return <Modal
        {...modalProps}
        title="Create RichCard"
        subtitle="Choose a link, saved service, or live listening activity. Preview it before inserting into your draft."
        notice={notice ? { message: notice, type: "warning" } : undefined}
        actions={[
            { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
            { text: "Insert into message", variant: "primary", onClick: insert, disabled: !card || !providerEnabled || hasExistingCard }
        ]}
    >
        <label className="rich-card-composer-select">Card source
            <select value={source} onChange={event => setSource(event.currentTarget.value)}>
                <option value="link">Public link</option><option value="profile">Saved server or service</option><option value="listening">Follow my Spotify listening</option>
            </select>
        </label>
        {source === "link" && <section className="rich-card-composer-field">
            <HeadingSecondary>Link</HeadingSecondary>
            <TextInput
                value={link}
                onChange={setLink}
                placeholder="Paste a game, music, stream, post or pull request link"
                autoFocus
                aria-label="RichCard link"
            />
        </section>}
        {source === "profile" && <label className="rich-card-composer-select">Saved connection
            <select value={profileId} onChange={event => setProfileId(event.currentTarget.value)}>
                <option value="">Choose a connection…</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.name} · {p.provider}</option>)}
            </select>
            <span>Manage connections in plugin settings. Other viewers need the same saved profile configured locally; private addresses are not included in the message.</span>
        </label>}
        {source === "listening" && <Paragraph>This card follows your Spotify activity while Discord shares it. To recommend a fixed song instead, choose Public link and paste its Spotify link.</Paragraph>}

        {card?.url && <label className="rich-card-composer-checkbox">
            <input type="checkbox" checked={includeUrl} onChange={event => setIncludeUrl(event.currentTarget.checked)} />
            Include the original link for people without DiscordRichCards
        </label>}

        {descriptor && card && Preview && <section className="rich-card-composer-preview">
            <HeadingSecondary>Preview</HeadingSecondary>
            <Paragraph>The live card data below uses the same provider and renderer as the posted message.</Paragraph>
            <Preview key={`${card.provider}:${card.kind}:${card.reference}`} descriptor={descriptor} />
        </section>}
    </Modal>;
}
