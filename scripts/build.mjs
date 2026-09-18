import { generateDevPlugin } from "./dev-plugin.mjs";
import { homedir } from "node:os";
import { cpSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const source = resolve(process.env.VENCORD_PATH || join(homedir(), "Vencord"));
const stage = resolve(".build/Vencord");
if (!existsSync(join(source, "node_modules/typescript"))) throw new Error("Set VENCORD_PATH to a Vencord checkout with installed dependencies.");
mkdirSync(stage, { recursive: true });
for (const name of ["src", "scripts", "packages", "browser", "package.json", "tsconfig.json"]) {
    cpSync(join(source, name), join(stage, name), { recursive: true });
}
const modules = join(stage, "node_modules");
if (!existsSync(modules)) symlinkSync(join(source, "node_modules"), modules, "junction");
if (process.argv.includes("--dev-plugin")) generateDevPlugin(join(stage, "src/userplugins/discordRichCardsDev"));
else cpSync(resolve("vencord/discordRichCards"), join(stage, "src/userplugins/discordRichCards"), { recursive: true });
const remote = spawnSync("git", ["-c", `safe.directory=${source.replaceAll("\\", "/")}`, "-C", source, "remote", "get-url", "origin"], { encoding: "utf8" });
if (remote.status !== 0) throw new Error("Cannot read Vencord origin for isolated build metadata");
const env = { ...process.env, VENCORD_HASH: "richcards-local", VENCORD_REMOTE: remote.stdout.trim().replace("https://github.com/", "").replace("git@github.com:", "").replace(/\.git$/, "") };
for (const args of [["scripts/build/build.mjs", "--dev"], [join(source, "node_modules/typescript/bin/tsc"), "--noEmit", "--skipLibCheck"]]) {
    const result = spawnSync(process.execPath, args, { cwd: stage, env, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log("Vencord build and type check passed in .build/Vencord; installed checkout was not changed.");
