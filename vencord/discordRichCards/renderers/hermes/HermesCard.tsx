import { useEffect, useMemo, useState } from "@webpack/common";
import { CardShell } from "../../components/CardShell";
import { useCard } from "../../useCard";
import { Native, settings } from "../../settings";
import { validateHermes } from "../../validation";
import type { BridgeResponse, HermesActivity, HermesSessionState, HermesStatus, RichCardDescriptor } from "../../types";
function statusLabel(status: HermesStatus) {
    switch (status) {
        case "queued": return "Queued";
        case "running": return "Running";
        case "waiting": return "Waiting";
        case "paused": return "Paused";
        case "success": return "Complete";
        case "error": return "Error";
        case "cancelled": return "Cancelled";
    }
}

function activityIcon(activity: HermesActivity) {
    switch (activity.status) {
        case "success": return "✓";
        case "error": return "!";
        case "running": return "◉";
        case "skipped": return "–";
        default: return "○";
    }
}

function clampProgress(progress: number | null | undefined) {
    if (typeof progress !== "number" || Number.isNaN(progress)) return 0;
    return Math.max(0, Math.min(100, progress));
}

function compactNumber(value: number | undefined) {
    if (value == null) return null;
    return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(ms: number | undefined) {
    if (ms == null) return "";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function formatElapsed(startedAt: string | undefined, finishedAt: string | undefined, now: number) {
    if (!startedAt) return "—";
    const start = Date.parse(startedAt);
    if (!Number.isFinite(start)) return "—";
    const end = finishedAt ? Date.parse(finishedAt) : now;
    const total = Math.max(0, Math.floor((Number.isFinite(end) ? end : now) - start) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function HermesCard({ descriptor }: { descriptor: RichCardDescriptor; }) {
    const sessionId = descriptor.reference;
    const { data: state, error, setError, refresh, refreshing } = useCard<HermesSessionState>(descriptor, validateHermes, 500);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [actionPending, setActionPending] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const progress = clampProgress(state?.progress);
    const elapsed = useMemo(
        () => formatElapsed(state?.startedAt, state?.finishedAt, now),
        [state?.startedAt, state?.finishedAt, now]
    );

    const sendAction = async (action: "pause" | "resume" | "cancel") => {
        setActionPending(action);
        try {
            const result = await Native.sendAction(
                settings.store.bridgeUrl,
                sessionId,
                action,
                settings.store.authToken,
                settings.store.acceptSelfSigned
            ) as BridgeResponse;
            if (!result.ok) setError(result.error ?? `Failed to send ${action}`);
        } catch { setError("Bridge action failed. Try again."); } finally { setActionPending(null); }
    };

    if (!state) {
        return (
            <CardShell>
                <div className={error ? "hermes-live-error" : "hermes-live-loading"}>
                    {error ? `Hermes Live: ${error}` : "Connecting to Hermes Live…"}
                </div>
            </CardShell>
        );
    }

    const canPause = (state.actions ?? []).includes("pause") && state.status === "running";
    const canResume = (state.actions ?? []).includes("resume") && state.status === "paused";
    const canCancel = (state.actions ?? []).includes("cancel") && !["success", "error", "cancelled"].includes(state.status);
    const showSpinner = ["queued", "running", "waiting"].includes(state.status);

    return (
        <CardShell status={state.status}>
            <div className="hermes-live-header">
                <div className="hermes-live-brand">
                    <div className="hermes-live-glyph">✦</div>
                    <div className="hermes-live-title-wrap">
                        <div className="hermes-live-eyebrow">Hermes Live</div>
                        <div className="hermes-live-title" title={state.title}>{state.title}</div>
                    </div>
                </div>
                <div className="hermes-live-status">
                    <span className="hermes-live-status-dot" />
                    {statusLabel(state.status)}
                </div>
            </div>

            <div className="hermes-live-body">
                <div className="hermes-live-current">
                    {showSpinner ? <span className="hermes-live-spinner" /> : <span>{state.status === "success" ? "✓" : state.status === "error" ? "!" : "•"}</span>}
                    <span>{state.current || statusLabel(state.status)}</span>
                </div>

                {state.progress != null && (
                    <div className="hermes-live-progress-shell" title={`${Math.round(progress)}%`}>
                        <div className="hermes-live-progress" style={{ width: `${progress}%` }} />
                    </div>
                )}

                <div className="hermes-live-meta">
                    {state.agent && <span className="hermes-live-pill">Agent <b>{state.agent}</b></span>}
                    {state.model && <span className="hermes-live-pill">Model <b>{state.model}</b></span>}
                    <span className="hermes-live-pill">Elapsed <b>{elapsed}</b></span>
                    {state.metrics?.tools != null && <span className="hermes-live-pill">Tools <b>{state.metrics.tools}</b></span>}
                    {state.metrics?.tokens != null && <span className="hermes-live-pill">Tokens <b>{compactNumber(state.metrics.tokens)}</b></span>}
                    {state.metrics?.contextPercent != null && <span className="hermes-live-pill">Context <b>{Math.round(state.metrics.contextPercent)}%</b></span>}
                </div>
            </div>

            {detailsOpen && (state.activity?.length ?? 0) > 0 && (
                <div className="hermes-live-details">
                    {state.activity!.map(activity => (
                        <div className="hermes-live-activity" data-state={activity.status} key={activity.id}>
                            <span className="hermes-live-activity-icon">{activityIcon(activity)}</span>
                            <span className="hermes-live-activity-label" title={activity.detail ?? activity.label}>{activity.label}</span>
                            <span className="hermes-live-activity-detail">{activity.detail || formatDuration(activity.durationMs)}</span>
                        </div>
                    ))}
                </div>
            )}

            {error && <div className="hermes-live-error">{error}</div>}

            <div className="hermes-live-footer">
                <div className="hermes-live-session">{state.sessionId}</div>
                <div className="hermes-live-actions">
                    {(state.activity?.length ?? 0) > 0 && (
                        <button className="hermes-live-button" onClick={() => setDetailsOpen(value => !value)}>
                            {detailsOpen ? "Hide details" : "Details"}
                        </button>
                    )}
                    <button className="hermes-live-button" disabled={refreshing} onClick={refresh}>Refresh</button>
                    {canPause && <button className="hermes-live-button" disabled={actionPending != null} onClick={() => void sendAction("pause")}>Pause</button>}
                    {canResume && <button className="hermes-live-button" disabled={actionPending != null} onClick={() => void sendAction("resume")}>Resume</button>}
                    {canCancel && <button className="hermes-live-button hermes-live-button--danger" disabled={actionPending != null} onClick={() => void sendAction("cancel")}>Stop</button>}
                </div>
            </div>
        </CardShell>
    );
}
