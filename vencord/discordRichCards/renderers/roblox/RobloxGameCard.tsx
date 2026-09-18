import { useState } from "@webpack/common";
import { CardShell } from "../../components/CardShell";
import { useCard } from "../../useCard";
import { validateRoblox } from "../../validation";
import { parseRobloxGameRef } from "../../marker";
import type { RichCardDescriptor } from "../../types";

const count = (value: number | null) => value === null ? "—" : value.toLocaleString();

export function RobloxGameCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const { data, error, notice, refresh, refreshDisabled, refreshLabel } = useCard(descriptor, validateRoblox, 30000);
    const [failedIcon, setFailedIcon] = useState<string | null>(null);
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const url = "https://www.roblox.com/games/" + parseRobloxGameRef(descriptor.reference)!;
    if (!data) return <CardShell><div className={error ? "hermes-live-error" : "hermes-live-loading"} role="status">{error || "Connecting to Roblox…"}</div></CardShell>;
    return <CardShell className="rich-card-roblox" status={data.status === "open" ? "success" : data.status === "locked" ? "error" : "paused"}>
        {data.thumbnailUrl && failedThumbnail !== data.thumbnailUrl && <div className="rich-card-roblox-artwork" aria-hidden="true">
            <img src={data.thumbnailUrl} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setFailedThumbnail(data.thumbnailUrl!)} />
        </div>}
        <div className="hermes-live-header rich-card-header">
            <div className="hermes-live-brand">
                <div className="hermes-live-glyph rich-card-roblox-icon" aria-hidden="true">
                    {data.iconUrl && failedIcon !== data.iconUrl
                        ? <img src={data.iconUrl} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setFailedIcon(data.iconUrl!)} />
                        : "◇"}
                </div>
                <div className="hermes-live-title-wrap">
                    <div className="hermes-live-eyebrow">Roblox · Experience</div>
                    <a className="hermes-live-title rich-card-roblox-title" href={url} target="_blank" rel="noreferrer">{data.name}</a>
                </div>
            </div>
            <span className="hermes-live-status" title={data.statusReason}>{data.status}</span>
        </div>
        <div className="hermes-live-body">
            <div className="rich-card-github-author">By <b>{data.creator || "Unknown creator"}</b></div>
            <dl className="rich-card-roblox-stats">
                <div><dt>Playing now</dt><dd>{count(data.playing)}</dd></div>
                <div><dt>Favorites</dt><dd>{count(data.favorites)}</dd></div>
                <div><dt>Visits</dt><dd>{count(data.visits)}</dd></div>
            </dl>
            <p className="rich-card-roblox-availability">{data.statusReason}</p>
        </div>
        {error && <div className="hermes-live-error" role="status">{error}</div>}
        {notice && <div className="hermes-live-loading" role="status">{notice}</div>}
        <div className="hermes-live-footer">
            <span className="hermes-live-session">Refreshes every 30s · Counts from Roblox</span>
            <div className="hermes-live-actions">
                <a className="hermes-live-button" href={url} target="_blank" rel="noreferrer">Open game ↗</a>
                <button className="hermes-live-button" disabled={refreshDisabled} onClick={refresh}>{refreshLabel}</button>
            </div>
        </div>
    </CardShell>;
}
