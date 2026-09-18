import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { insertTextIntoChatInputBox } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { DraftStore, DraftType, Modal, SelectedChannelStore, showToast, TextInput, Toasts, UserStore, useMemo, useState } from "@webpack/common";
import { buildComposerInsertion, parseComposerLink, parseMarkers } from "../marker";
import { GitHubPRCard } from "../renderers/github/GitHubPRCard";
import { RobloxGameCard } from "../renderers/roblox/RobloxGameCard";
import { settings } from "../settings";

function isOwnAuthorAllowed(botUserIds: string) {
    const allowed = botUserIds.split(",").map(id => id.trim()).filter(Boolean);
    const userId = UserStore.getCurrentUser()?.id;
    return !allowed.length || Boolean(userId && allowed.includes(userId));
}

export function ComposerModal({ channelId, ...modalProps }: RenderModalProps & { channelId: string; }) {
    const [link, setLink] = useState("");
    const [includeUrl, setIncludeUrl] = useState(true);
    const { enableGitHub, enableRoblox, botUserIds } = settings.use(["enableGitHub", "enableRoblox", "botUserIds"]);
    const card = useMemo(() => parseComposerLink(link), [link]);
    const providerEnabled = card?.provider === "github" ? enableGitHub : card?.provider === "roblox" ? enableRoblox : false;
    const descriptor = card && providerEnabled ? { ...card, rawMarker: "" } : null;
    const Preview = card?.provider === "github" ? GitHubPRCard : RobloxGameCard;
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

    const notice = !card && link.trim()
        ? "Paste a public GitHub pull request or Roblox game URL."
        : card && !providerEnabled
            ? `${card.provider === "github" ? "GitHub" : "Roblox"} cards are disabled in DiscordRichCards settings.`
            : hasExistingCard
                ? "This channel's draft already contains a RichCard marker. One card is allowed per message."
                : !ownAuthorAllowed
                    ? "Your Allowed Discord author IDs setting excludes your account, so this card will not render for you."
                    : undefined;

    return <Modal
        {...modalProps}
        title="Create RichCard"
        subtitle="Paste a GitHub pull request or Roblox game link, preview it, then insert it into this draft."
        notice={notice ? { message: notice, type: "warning" } : undefined}
        actions={[
            { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
            { text: "Insert into message", variant: "primary", onClick: insert, disabled: !card || !providerEnabled || hasExistingCard }
        ]}
    >
        <section className="rich-card-composer-field">
            <HeadingSecondary>Link</HeadingSecondary>
            <TextInput
                value={link}
                onChange={setLink}
                placeholder="https://github.com/owner/repo/pull/123"
                autoFocus
                aria-label="RichCard link"
            />
        </section>

        <label className="rich-card-composer-checkbox">
            <input type="checkbox" checked={includeUrl} onChange={event => setIncludeUrl(event.currentTarget.checked)} />
            Include the original link for people without DiscordRichCards
        </label>

        {descriptor && card && <section className="rich-card-composer-preview">
            <HeadingSecondary>Preview</HeadingSecondary>
            <Paragraph>The live card data below uses the same provider and renderer as the posted message.</Paragraph>
            <Preview key={`${card.provider}:${card.kind}:${card.reference}`} descriptor={descriptor} />
        </section>}
    </Modal>;
}
