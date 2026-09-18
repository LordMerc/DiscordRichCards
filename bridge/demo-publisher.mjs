const BASE = (process.env.RICHCARDS_URL || process.env.HERMES_LIVE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const TOKEN = process.env.RICHCARDS_TOKEN || process.env.HERMES_LIVE_TOKEN || "";
const SESSION = process.env.RICHCARDS_SESSION || process.env.HERMES_LIVE_SESSION || "demo-001";

let lastActionId = 0;
let paused = false;
let cancelled = false;

function headers() {
    return { "Content-Type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
}

async function call(route, options = {}) {
    const response = await fetch(`${BASE}${route}`, { ...options, headers: { ...headers(), ...options.headers } });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
}

function patch(payload) {
    return call(`/api/sessions/${encodeURIComponent(SESSION)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

async function readActions() {
    const actions = await call(`/api/sessions/${encodeURIComponent(SESSION)}/actions?after=${lastActionId}`);
    for (const item of actions) {
        lastActionId = Math.max(lastActionId, item.id);
        if (item.action === "pause") paused = true;
        if (item.action === "resume") paused = false;
        if (item.action === "cancel") cancelled = true;
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await call(`/api/sessions/${encodeURIComponent(SESSION)}`, {
    method: "PUT",
    body: JSON.stringify({
        title: "Fix inventory replication",
        status: "running",
        agent: "Sol Engineer",
        model: "Claude Sonnet",
        current: "Planning changes…",
        progress: 7,
        startedAt: new Date().toISOString(),
        metrics: { tools: 0, tokens: 920, contextPercent: 12 },
        activity: [
            { id: "plan", label: "Plan implementation", status: "running" },
            { id: "inspect", label: "Inspect Roblox files", status: "pending" },
            { id: "patch", label: "Apply patch", status: "pending" },
            { id: "verify", label: "Verify result", status: "pending" }
        ],
        actions: ["pause", "resume", "cancel"]
    })
});

console.log(`Demo session: ${SESSION}`);
console.log(`Legacy marker: [[hermes-live:${SESSION}]]`);
console.log(`RichCards marker: [[richcard:hermes:session:${SESSION}]]`);

const stages = [
    { wait: 2400, state: { current: "Inspecting project files…", progress: 28, metrics: { tools: 1, tokens: 2400, contextPercent: 18 }, activity: [{ id: "plan", label: "Plan implementation", status: "success", durationMs: 1800 }, { id: "inspect", label: "Inspect Roblox files", status: "running", detail: "Roblox Studio MCP" }, { id: "patch", label: "Apply patch", status: "pending" }, { id: "verify", label: "Verify result", status: "pending" }] } },
    { wait: 3300, state: { current: "Applying server-authoritative replication patch…", progress: 57, metrics: { tools: 3, tokens: 5100, contextPercent: 27 }, activity: [{ id: "plan", label: "Plan implementation", status: "success", durationMs: 1800 }, { id: "inspect", label: "Inspect Roblox files", status: "success", durationMs: 3100 }, { id: "patch", label: "Apply patch", status: "running", detail: "3 files" }, { id: "verify", label: "Verify result", status: "pending" }] } },
    { wait: 3900, state: { current: "Running verification checks…", progress: 83, metrics: { tools: 5, tokens: 7900, contextPercent: 34 }, activity: [{ id: "plan", label: "Plan implementation", status: "success", durationMs: 1800 }, { id: "inspect", label: "Inspect Roblox files", status: "success", durationMs: 3100 }, { id: "patch", label: "Apply patch", status: "success", durationMs: 3600 }, { id: "verify", label: "Verify result", status: "running", detail: "2/3 checks" }] } },
    { wait: 3100, state: { status: "success", current: "Patch verified successfully.", progress: 100, metrics: { tools: 6, tokens: 8800, contextPercent: 37 }, activity: [{ id: "plan", label: "Plan implementation", status: "success", durationMs: 1800 }, { id: "inspect", label: "Inspect Roblox files", status: "success", durationMs: 3100 }, { id: "patch", label: "Apply patch", status: "success", durationMs: 3600 }, { id: "verify", label: "Verify result", status: "success", durationMs: 2900 }], actions: [] } }
];

for (const stage of stages) {
    for (let elapsed = 0; elapsed < stage.wait; elapsed += 700) {
        await sleep(Math.min(700, stage.wait - elapsed));
        await readActions();
        if (cancelled) {
            await patch({ status: "cancelled", current: "Stopped from Discord.", actions: [] });
            process.exit(0);
        }
        if (paused) {
            await patch({ status: "paused", current: "Paused from Discord.", actions: ["resume", "cancel"] });
            while (paused && !cancelled) {
                await sleep(700);
                await readActions();
            }
            if (cancelled) {
                await patch({ status: "cancelled", current: "Stopped from Discord.", actions: [] });
                process.exit(0);
            }
            await patch({ status: "running", current: "Resuming Hermes task…", actions: ["pause", "cancel"] });
        }
    }
    await patch(stage.state);
}

console.log("Demo complete.");
