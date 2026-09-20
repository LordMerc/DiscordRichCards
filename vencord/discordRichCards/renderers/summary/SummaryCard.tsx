import type { FluxStore } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { PresenceStore, UserStore, useEffect, useState, useStateFromStores } from "@webpack/common";
import { providerGlyphs, providerLabels } from "../../bridge/providers.mjs";
import { CardShell } from "../../components/CardShell";
import { formatSummaryField, safeSummaryUrl, spotifyActivitiesForUser, spotifyActivity, validateSummary } from "../../expandedClient";
import type { SummaryData } from "../../expandedClient";
import type { RichCardDescriptor } from "../../types";
import { useCard } from "../../useCard";

const LocalActivityStore = findStoreLazy("LocalActivityStore") as FluxStore & { getActivities(): unknown; };

function duration(milliseconds: number) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function useClock() {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    return now;
}
function TimeLabel({ data }: { data: SummaryData; }) {
    const now = useClock();
    const start = data.startedAt ? Date.parse(data.startedAt) : NaN;
    const end = data.endsAt ? Date.parse(data.endsAt) : NaN;
    if (data.status === "scheduled" && Number.isFinite(start)) return <span>{start > now ? `Starts in ${duration(start - now)}` : "Waiting for the stream to start"}</span>;
    if (data.status === "live" && Number.isFinite(start)) return <span>Live for {duration(now - start)}</span>;
    if (data.status === "ended" && Number.isFinite(end)) return <span>Ended {new Date(end).toLocaleString()}</span>;
    return Number.isFinite(start) ? <span>{new Date(start).toLocaleString()}</span> : null;
}
function Artwork({ src, provider }: { src?: string; provider: string; }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    return <div className="rich-card-summary-art" aria-hidden="true">{src && !failed
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <span>{providerGlyphs[provider] ?? "●"}</span>}</div>;
}
function SummaryBody({ provider, data }: { provider: string; data: SummaryData; }) {
    return <>
        <div className="rich-card-summary-heading">
            <Artwork src={data.imageUrl} provider={provider} />
            <div className="rich-card-summary-heading-text">
                <div className="hermes-live-eyebrow">{providerLabels[provider]}</div>
                <div className="rich-card-summary-title">{data.title}</div>
                {data.subtitle && <div className="rich-card-summary-subtitle">{data.subtitle}</div>}
            </div>
            <span className="rich-card-summary-status" data-state={data.status}>{data.statusLabel}</span>
        </div>
        {(data.description || data.fields.length > 0) && <div className="rich-card-summary-body">
            {data.description && <p className="rich-card-summary-description">{data.description}</p>}
            {data.fields.length > 0 && <dl className="rich-card-summary-metrics">{data.fields.map((field, index) => <div key={`${field.label}:${index}`}><dt>{field.label}</dt><dd>{formatSummaryField(field)}</dd></div>)}</dl>}
        </div>}
        {provider === "dockhand" && data.containers && <ContainerDetails containers={data.containers} />}
    </>;
}

function ContainerDetails({ containers }: { containers: NonNullable<SummaryData["containers"]>; }) {
    const rows = (items: typeof containers) => <ul className="rich-card-container-list">{items.map(item => <li key={item.name}>
        <div className="rich-card-container-heading"><strong>{item.name}</strong><span className="rich-card-summary-status" data-state={item.state === "running" ? "online" : "unknown"}>{item.state}</span></div>
        <p>{item.status}</p>
        {item.image && <code>{item.image}</code>}
        <div className="rich-card-container-update" data-update={item.updateStatus}>{item.updateStatus === "available" ? "↑ Update available" : item.updateStatus === "none-reported" ? "No pending update reported" : "Update status unavailable"}</div>
        <div className="rich-card-container-dates">
            {item.createdAt && <span>Created <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></span>}
            {item.updateCheckedAt && <span>Update checked <time dateTime={item.updateCheckedAt}>{new Date(item.updateCheckedAt).toLocaleString()}</time></span>}
        </div>
    </li>)}</ul>;
    return <div className="rich-card-container-details">{rows(containers.slice(0, 3))}{containers.length > 3 && <details><summary>More containers ({containers.length - 3})</summary>{rows(containers.slice(3))}</details>}</div>;
}

export function SummaryCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const { data, error, notice, refresh, refreshDisabled, refreshLabel, fetchedAt } = useCard(descriptor, validateSummary, 30000);
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState(false);
    const fallbackUrl = descriptor.provider === "spotify" ? `https://open.spotify.com/${descriptor.kind}/${descriptor.reference}`
        : descriptor.provider === "twitch" ? `https://www.twitch.tv/${descriptor.reference}`
            : descriptor.provider === "steam" ? `https://store.steampowered.com/app/${descriptor.reference}/`
                : descriptor.provider === "youtube" ? `https://www.youtube.com/watch?v=${descriptor.reference}`
                    : descriptor.provider === "x" ? `https://x.com/i/status/${descriptor.reference}` : undefined;
    const openUrl = data?.url ?? (safeSummaryUrl(fallbackUrl) ? fallbackUrl : undefined);
    useEffect(() => { setCopied(false); setCopyError(false); }, [data?.copyText]);
    const copy = async () => {
        try { await navigator.clipboard.writeText(data?.copyText ?? ""); setCopied(true); setCopyError(false); }
        catch { setCopyError(true); }
    };
    return <CardShell className={`rich-card-summary rich-card-summary-${descriptor.provider}`} status={data?.status === "outage" ? "error" : "queued"}>
        {data ? <SummaryBody provider={descriptor.provider} data={data} /> : <div className="rich-card-summary-empty">
            <div className="hermes-live-eyebrow">{providerLabels[descriptor.provider]}</div>
            <div role="status">{error || "Loading card…"}</div>
            {error && <p>Check this provider in DiscordRichCards → Connections.</p>}
        </div>}
        {data && error && <div className="hermes-live-error" role="status">Last fetched data · {error}</div>}
        {notice && <div className="hermes-live-loading" role="status">{notice}</div>}
        {copyError && <div className="hermes-live-error" role="status">Could not copy. Server address: {data?.copyText}</div>}
        <div className="hermes-live-footer">
            <span className="hermes-live-session">{data && <TimeLabel data={data} />}{fetchedAt && <span> · Checked {new Date(fetchedAt).toLocaleTimeString()}</span>}{!data && "Live RichCard"}</span>
            <div className="hermes-live-actions">
                {data?.copyText && <button className="hermes-live-button" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>}
                {openUrl && <a className="hermes-live-button" href={openUrl} target="_blank" rel="noreferrer">{descriptor.provider === "fivem" ? "Join server" : "Open"} ↗</a>}
                <button className="hermes-live-button" disabled={refreshDisabled} onClick={refresh}>{refreshLabel}</button>
            </div>
        </div>
    </CardShell>;
}

export function SpotifyListeningCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const activities = useStateFromStores([PresenceStore, LocalActivityStore, UserStore], () => spotifyActivitiesForUser(
        descriptor.reference,
        UserStore.getCurrentUser()?.id,
        LocalActivityStore.getActivities(),
        PresenceStore.getActivities(descriptor.reference)
    ));
    const now = useClock();
    const data = spotifyActivity(activities, now);
    return <CardShell className="rich-card-summary rich-card-summary-spotify">
        {data ? <>
            <SummaryBody provider="spotify" data={data} />
            <div className="rich-card-listening-progress">
                <progress aria-label="Track progress" value={data.elapsedMs} max={data.durationMs} />
                <div><span>{duration(data.elapsedMs)}</span><span>{duration(data.durationMs)}</span></div>
            </div>
            <div className="hermes-live-footer"><span className="hermes-live-session">Following visible Discord activity</span><a className="hermes-live-button" href={data.url} target="_blank" rel="noreferrer">Open Spotify ↗</a></div>
        </> : <div className="rich-card-summary-empty" role="status"><div className="hermes-live-eyebrow">Spotify · Live listening</div><div>Activity unavailable</div><p>This person’s Spotify activity is not currently visible to you in Discord.</p></div>}
    </CardShell>;
}
