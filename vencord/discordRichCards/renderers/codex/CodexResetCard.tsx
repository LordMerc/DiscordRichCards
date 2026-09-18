import { CardShell } from "../../components/CardShell";
import { useCard } from "../../useCard";
import { validateCodex } from "../../validation";
import type { RichCardDescriptor } from "../../types";

const TRACKER_URL = "https://hascodexratelimitreset.today/";

function formatTime(value: string | null) {
    if (!value) return "—";
    const date = Date.parse(value);
    return Number.isFinite(date) ? new Date(date).toLocaleString() : "—";
}

function answerLabel(state: "yes" | "no" | "unknown") {
    return state === "yes" ? "Yes" : state === "no" ? "No" : "Unknown";
}

export function CodexResetCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const { data, error, notice, refresh, refreshDisabled, refreshLabel } = useCard(descriptor, validateCodex, 30000);
    if (!data) return <CardShell className="rich-card-codex"><div className={error ? "hermes-live-error" : "hermes-live-loading"} role="status">{error || "Checking the Codex reset tracker…"}</div></CardShell>;

    const paused = data.monitor === "inactive";
    const unavailable = data.monitor === "unknown";
    const status = paused ? "paused" : unavailable ? "queued" : data.state === "yes" ? "success" : data.state === "no" ? "paused" : "queued";
    const post = data.tweetUrl
        ? <a className="rich-card-codex-post" href={data.tweetUrl} target="_blank" rel="noreferrer">{data.tweetText || "Open latest post ↗"}</a>
        : <p className="rich-card-codex-post">{data.tweetText || "No recent post is available."}</p>;

    return <CardShell className="rich-card-codex" status={status}>
        <div className="hermes-live-header rich-card-header">
            <div className="hermes-live-brand">
                <div className="hermes-live-glyph rich-card-codex-glyph" aria-hidden="true">✦</div>
                <div className="hermes-live-title-wrap">
                    <div className="hermes-live-eyebrow">Community Codex tracker</div>
                    <div className="hermes-live-title">Has Codex reset?</div>
                </div>
            </div>
            <span className="hermes-live-status">{data.monitor === "active" ? "Monitoring" : "Source status"}</span>
        </div>
        <div className="hermes-live-body rich-card-codex-body">
            <div className="rich-card-codex-answer">{paused ? "Tracker paused" : unavailable ? "Tracker status unknown" : answerLabel(data.state)}</div>
            {(paused || unavailable) && <p className="rich-card-codex-verdict">Last reported: <b>{answerLabel(data.state)}</b></p>}
            <p className="rich-card-codex-source" role="status">
                {paused ? "Source checks paused" : unavailable ? "Source checks unconfirmed" : "Source monitoring active"}
                {" � Last checked "}{formatTime(data.checkedAt)}
            </p>
            <p className="rich-card-codex-disclaimer">Community tracker, not your personal Codex quota.</p>
            <details className="rich-card-codex-details">
                <summary>Latest post &amp; reasoning</summary>
                <div className="rich-card-codex-detail">
                    <span>Latest post</span>
                    {post}
                </div>
                <div className="rich-card-codex-detail">
                    <span>Reasoning</span>
                    <p>{data.rationale || "No reasoning was provided."}</p>
                </div>
            </details>
            <div className="rich-card-codex-times">
                <span>Last reported reset <b>{formatTime(data.resetAt)}</b></span>
            </div>
        </div>
        {error && <div className="hermes-live-error" role="status">Showing last fetched data. {error}</div>}
        {notice && <div className="hermes-live-loading" role="status">{notice}</div>}
        <div className="hermes-live-footer">
            <span className="hermes-live-session">hascodexratelimitreset.today</span>
            <div className="hermes-live-actions">
                <a className="hermes-live-button" href={TRACKER_URL} target="_blank" rel="noreferrer">Open site ↗</a>
                <button className="hermes-live-button" disabled={refreshDisabled} onClick={refresh}>{refreshLabel}</button>
            </div>
        </div>
    </CardShell>;
}
