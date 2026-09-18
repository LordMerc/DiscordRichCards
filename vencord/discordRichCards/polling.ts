// Sequential scheduling prevents slow requests from accumulating. Each mount owns its loop.
export function startPolling(request: () => Promise<number>, fallbackMs: number) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
        let delay = fallbackMs;
        try { delay = await request(); } catch { /* Request owner displays the error; keep recovery alive. */ }
        if (!stopped) timer = setTimeout(tick, Number.isFinite(delay) ? Math.max(500, Math.min(300000, delay)) : fallbackMs);
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
}
