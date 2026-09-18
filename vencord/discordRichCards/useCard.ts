import { useEffect, useState } from "@webpack/common";
import { Native, settings, debug } from "./settings";
import { startPolling } from "./polling";
import type { RichCardDescriptor, RichCardEnvelope } from "./types";

export function useCard<T>(descriptor: RichCardDescriptor, validate: (value: unknown) => value is T, minimumMs: number) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const { bridgeUrl, authToken, acceptSelfSigned, pollIntervalMs, useExternalBridge } = settings.use(["bridgeUrl", "authToken", "acceptSelfSigned", "pollIntervalMs", "useExternalBridge"]);
    const { provider, kind, reference } = descriptor;

    useEffect(() => {
        let disposed = false;
        const fallback = Math.max(minimumMs, provider === "hermes" ? (pollIntervalMs || 1000) : 30000);
        let forceRefresh = revision > 0;
        const stop = startPolling(async () => {
            if (!disposed) setRefreshing(true);
            let delay = fallback;
            let refreshQueued = false;
            try {
                debug("request", `${provider}.${kind}`);
                const response = await Native.getCard(bridgeUrl, provider, kind, reference, authToken, acceptSelfSigned, forceRefresh, provider === "hermes" || useExternalBridge);
                if (disposed) return delay;
                debug("response status", response.status);
                if (!response.ok) throw new Error(response.error || `Bridge request failed (${response.status})`);
                const envelope = response.data as RichCardEnvelope;
                if (!envelope || envelope.version !== 1 || envelope.provider !== provider || envelope.kind !== kind || !validate(envelope.data)) {
                    throw new Error("Malformed bridge response");
                }
                setData(envelope.data);
                setError(typeof envelope.warning === "string" ? envelope.warning : null);
                if (Number.isFinite(envelope.refreshAfterMs)) delay = Math.max(minimumMs, fallback, envelope.refreshAfterMs!);
                if (forceRefresh && Number.isFinite(envelope.refreshDeferredMs) && envelope.refreshDeferredMs! > 0) {
                    delay = Math.max(500, Math.min(5000, envelope.refreshDeferredMs!));
                    refreshQueued = true;
                    setNotice("Refresh queued — checking GitHub again shortly…");
                } else {
                    forceRefresh = false;
                    setNotice(null);
                }
            } catch (cause) {
                forceRefresh = false;
                if (!disposed) {
                    setError(cause instanceof Error ? cause.message : "Bridge unavailable");
                    setNotice(null);
                }
            } finally {
                if (!disposed) setRefreshing(refreshQueued);
            }
            return delay;
        }, fallback);
        return () => { disposed = true; stop(); };
    }, [provider, kind, reference, bridgeUrl, authToken, acceptSelfSigned, pollIntervalMs, useExternalBridge, revision]);

    return { data, error, setError, notice, refreshing, refresh: () => { if (!refreshing) setRevision(value => value + 1); } };
}
