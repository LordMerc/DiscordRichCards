import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge as createPluginBridge } from "../vencord/discordRichCards/bridge/runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function standaloneOptions(options = {}) {
    const env = options.env ?? process.env;
    return {
        ...options,
        dataFile: options.dataFile ?? env.RICHCARDS_DATA ?? env.HERMES_LIVE_DATA ?? path.join(__dirname, "hermes-live-data.json")
    };
}

export function createBridge(options = {}) {
    return createPluginBridge(standaloneOptions(options));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const bridge = createBridge();
    await bridge.listen();
    const env = process.env;
    const host = env.RICHCARDS_HOST ?? env.HERMES_LIVE_HOST ?? "127.0.0.1";
    console.log(`Discord RichCards bridge listening on http://${host}:${bridge.port}`);
    console.log(`Data file: ${standaloneOptions().dataFile}`);
    if (!(env.RICHCARDS_TOKEN ?? env.HERMES_LIVE_TOKEN)) console.warn("WARNING: RICHCARDS_TOKEN is empty. Keep this bridge on a trusted local network.");
}
