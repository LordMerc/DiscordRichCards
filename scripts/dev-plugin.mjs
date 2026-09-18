import { homedir } from "node:os";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Generate from the same source; never install over the stable plugin folder.
export function generateDevPlugin(destination) {
    const target = resolve(destination);
    if (basename(target) !== "discordRichCardsDev") throw new Error("Development target must be named discordRichCardsDev");
    function copy(source, output) {
        mkdirSync(output, { recursive: true });
        for (const entry of readdirSync(source, { withFileTypes: true })) {
            const input = join(source, entry.name);
            const dest = join(output, entry.name);
            if (entry.isDirectory()) { copy(input, dest); continue; }
            if (!entry.isFile()) throw new Error("Unexpected non-file in plugin source");
            let text = readFileSync(input, "utf8")
                .replaceAll("DiscordRichCards", "DiscordRichCardsDev")
                .replaceAll("github.com/LordMerc/DiscordRichCardsDev", "github.com/LordMerc/DiscordRichCards")
                .replaceAll("discord-richcards", "discord-richcards-dev")
                .replaceAll("hermes-live-", "richcards-dev-hermes-")
                .replaceAll("rich-card", "richcards-dev-card")
                .replaceAll("hermesLive", "richcardsDevHermes");
            if (entry.name === "marker.ts") {
                if (!text.includes("richcard(?")) throw new Error("Marker grammar changed; update development generator");
                text = text.replace("richcard(?", "richcard-dev(?")
                    .replace("hermes-live:(?<session>", "(?!)hermes-live:(?<session>");
            }
            writeFileSync(dest, text);
        }
    }
    copy(join(root, "vencord/discordRichCards"), target);
    return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--install")) throw new Error("Usage: node scripts/dev-plugin.mjs [--install]");
    const target = args.includes("--install")
        ? join(resolve(process.env.VENCORD_PATH || join(homedir(), "Vencord")), "src/userplugins/discordRichCardsDev")
        : join(root, ".build/discordRichCardsDev");
    console.log("Generated " + generateDevPlugin(target));
    console.log("Use [[richcard-dev:roblox:game:129932912185311]]. Rebuild Vencord and restart Discord after installing.");
}
