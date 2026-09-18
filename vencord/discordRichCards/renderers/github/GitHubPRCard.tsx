import { CardShell } from "../../components/CardShell";
import { useCard } from "../../useCard";
import { validateGitHub } from "../../validation";
import { parseGitHubPRRef } from "../../marker";
import type { RichCardDescriptor } from "../../types";

export function GitHubPRCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const { data, error, notice, refresh, refreshDisabled, refreshLabel } = useCard(descriptor, validateGitHub, 15000);
    const ref = parseGitHubPRRef(descriptor.reference)!;
    // Construct the destination from the validated marker, never from an upstream URL.
    const url = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
    if (!data) return <CardShell><div className={error ? "hermes-live-error" : "hermes-live-loading"} role="status">{error || "Connecting to GitHub…"}</div></CardShell>;
    const status = data.draft ? "Draft" : data.state;
    const updated = Date.parse(data.updatedAt);
    return <CardShell className="rich-card-github" status={data.state === "open" ? (data.draft ? "paused" : "success") : data.state === "merged" ? "merged" : "cancelled"}>
        <div className="hermes-live-header rich-card-header">
            <div className="hermes-live-brand">
                <div className="hermes-live-glyph" aria-hidden="true">⑂</div>
                <div className="hermes-live-title-wrap">
                    <div className="hermes-live-eyebrow">GitHub · Pull request</div>
                    <div className="hermes-live-title" title={`${data.owner}/${data.repo}`}>{data.owner}<span className="rich-card-github-slash"> / </span>{data.repo}</div>
                </div>
            </div>
            <span className="hermes-live-status">{status}</span>
        </div>
        <div className="hermes-live-body">
            <a className="rich-card-github-title" href={url} target="_blank" rel="noreferrer"><span>#{data.number}</span> {data.title}</a>
            <div className="rich-card-github-author">Opened by <b>{data.author}</b></div>
            <div className="rich-card-github-branches"><code title={data.head}>{data.head}</code><span aria-label="into">→</span><code title={data.base}>{data.base}</code></div>
            <div className="rich-card-github-stats">
                <span className="rich-card-github-additions">+{data.additions.toLocaleString()}</span>
                <span className="rich-card-github-deletions">−{data.deletions.toLocaleString()}</span>
                <span>{data.changedFiles} files</span><span>{data.comments} comments</span>
            </div>
            {data.labels.length > 0 && <div className="hermes-live-meta">{data.labels.map(label => <span className="hermes-live-pill" key={label}>{label}</span>)}</div>}
        </div>
        {error && <div className="hermes-live-error" role="status">Showing last fetched data. {error}</div>}
        {notice && <div className="hermes-live-loading" role="status">{notice}</div>}
        <div className="hermes-live-footer">
            <span className="hermes-live-session">Updated {Number.isFinite(updated) ? new Date(updated).toLocaleString() : "—"}</span>
            <div className="hermes-live-actions">
                <a className="hermes-live-button" href={url} target="_blank" rel="noreferrer">Open PR ↗</a>
                <button className="hermes-live-button" disabled={refreshDisabled} onClick={refresh}>{refreshLabel}</button>
            </div>
        </div>
    </CardShell>;
}
