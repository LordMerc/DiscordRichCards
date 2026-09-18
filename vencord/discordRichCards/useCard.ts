import { useEffect, useRef, useState } from "@webpack/common";
import { Native, settings, debug } from "./settings";
import { startPolling } from "./polling";
import { getManualRefreshCooldownRemaining, getRefreshLabel, MANUAL_REFRESH_COOLDOWN_MS } from "./refresh";
import type { RichCardDescriptor, RichCardEnvelope } from "./types";
import { getConnectionsRevision, subscribeConnections } from "./connectionsUi";

export function useCard<T>(descriptor: RichCardDescriptor, validate: (value: unknown) => value is T, minimumMs: number) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [manualCooldownUntil, setManualCooldownUntil] = useState(0);
    const [manualCooldownRemaining, setManualCooldownRemaining] = useState(0);
    const [fetchedAt, setFetchedAt] = useState<string | null>(null);
    const [connectionsRevision, setConnectionsRevision] = useState(getConnectionsRevision());
    const manualIntentRef = useRef(false);
    const manualCooldownUntilRef = useRef(0);
    const { bridgeUrl, authToken, acceptSelfSigned, pollIntervalMs, useExternalBridge } = settings.use(["bridgeUrl", "authToken", "acceptSelfSigned", "pollIntervalMs", "useExternalBridge"]);
    const { provider, kind, reference } = descriptor;

    useEffect(() => subscribeConnections(() => {
        manualIntentRef.current = false;
        setData(null); setError(null); setFetchedAt(null);
        setConnectionsRevision(getConnectionsRevision());
    }), []);

    useEffect(() => {
        let disposed = false;
        const fallback = Math.max(minimumMs, provider === "hermes" ? (pollIntervalMs || 1000) : 30000);
        let forceRefresh = manualIntentRef.current;
        manualIntentRef.current = false;
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
                setFetchedAt(typeof envelope.fetchedAt === "string" && Number.isFinite(Date.parse(envelope.fetchedAt)) ? envelope.fetchedAt : null);
                setError(typeof envelope.warning === "string" ? envelope.warning : null);
                if (Number.isFinite(envelope.refreshAfterMs)) delay = Math.max(minimumMs, fallback, envelope.refreshAfterMs!);
                if (forceRefresh && Number.isFinite(envelope.refreshDeferredMs) && envelope.refreshDeferredMs! > 0) {
                    delay = Math.max(500, Math.min(5000, envelope.refreshDeferredMs!));
                    refreshQueued = true;
                    setNotice("Refresh queued — checking again shortly…");
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
    }, [provider, kind, reference, bridgeUrl, authToken, acceptSelfSigned, pollIntervalMs, useExternalBridge, revision, connectionsRevision]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const update = () => {
            const remaining = getManualRefreshCooldownRemaining(manualCooldownUntil);
            setManualCooldownRemaining(remaining);
            if (remaining > 0) timer = setTimeout(update, Math.min(1000, remaining));
        };
        update();
        return () => { if (timer) clearTimeout(timer); };
    }, [manualCooldownUntil]);

    const refresh = () => {
        const now = Date.now();
        if (refreshing || getManualRefreshCooldownRemaining(manualCooldownUntilRef.current, now) > 0) return;
        const cooldownUntil = now + MANUAL_REFRESH_COOLDOWN_MS;
        // Update the ref first so two click events in the same render cannot issue two requests.
        manualCooldownUntilRef.current = cooldownUntil;
        setManualCooldownUntil(cooldownUntil);
        manualIntentRef.current = true;
        setRevision(value => value + 1);
    };
    const refreshDisabled = refreshing || manualCooldownRemaining > 0;
    const refreshLabel = getRefreshLabel(refreshing, manualCooldownRemaining);

    return { data, error, setError, notice, refreshing, refresh, refreshDisabled, refreshLabel, fetchedAt };
}
