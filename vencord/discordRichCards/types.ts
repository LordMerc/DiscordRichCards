export type HermesStatus = "queued" | "running" | "waiting" | "paused" | "success" | "error" | "cancelled";
export type HermesActivityStatus = "pending" | "running" | "success" | "error" | "skipped";

export interface HermesActivity {
    id: string;
    label: string;
    status: HermesActivityStatus;
    detail?: string;
    durationMs?: number;
}

export interface HermesMetrics {
    tools?: number;
    tokens?: number;
    contextPercent?: number;
}

export interface HermesSessionState {
    version: 1;
    sessionId: string;
    title: string;
    status: HermesStatus;
    agent?: string;
    model?: string;
    current?: string;
    progress?: number | null;
    startedAt?: string;
    updatedAt?: string;
    finishedAt?: string;
    activity?: HermesActivity[];
    metrics?: HermesMetrics;
    actions?: Array<"pause" | "resume" | "cancel">;
}

export interface BridgeResponse<T = unknown> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
}

export interface RichCardDescriptor {
    provider: string;
    kind: string;
    reference: string;
    rawMarker: string;
}

export interface RichCardEnvelope<T = unknown> {
    version: 1;
    key: string;
    provider: string;
    kind: string;
    fetchedAt: string;
    refreshAfterMs?: number;
    stale?: boolean;
    warning?: string;
    refreshDeferredMs?: number;
    data: T;
}
