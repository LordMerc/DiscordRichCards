export interface CodexReset {
    state: "yes" | "no" | "unknown";
    monitor: "active" | "inactive" | "unknown";
    checkedAt: string | null;
    resetAt: string | null;
    tweetText: string;
    tweetUrl: string | null;
    rationale: string;
}
