import { homedir } from "node:os";
// Visual fixture: real card markup/CSS, static provider data, no Discord or GitHub access.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(join(resolve(process.env.VENCORD_PATH || join(homedir(), "Vencord")), "package.json"));
const { build } = require("esbuild");
const fixture = { owner: "Vendicated", repo: "Vencord", number: 4607, title: "Keep live cards in sync across channel navigation", state: "open", draft: false, author: "contributor", head: "feature/persistent-richcards", base: "main", additions: 241, deletions: 93, changedFiles: 6, comments: 4, labels: ["enhancement", "userplugins"], createdAt: "2026-09-17T20:00:00Z", updatedAt: "2026-09-18T02:00:00Z", url: "https://github.com/Vendicated/Vencord/pull/4607" };
mkdirSync(".build/preview", { recursive: true });
await build({
    stdin: { contents: 'import { GitHubPRCard } from "./vencord/discordRichCards/renderers/github/GitHubPRCard"; export default GitHubPRCard({descriptor: {provider:"github",kind:"pr",reference:"Vendicated/Vencord#4607"}});', resolveDir: process.cwd(), loader: "tsx" },
    outfile: ".build/preview/card.mjs", bundle: true, platform: "node", format: "esm", jsxFactory: "h",
    banner: { js: 'function h(tag, props, ...children) { if (typeof tag === "function") return tag({...props, children}); return {tag,props:props||{},children}; }' },
    plugins: [{ name: "fixture", setup(b) {
        b.onResolve({ filter: /\/useCard$/ }, () => ({ path: "fixture", namespace: "fixture" }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export function useCard() { return {data:${JSON.stringify(fixture)},error:null,refresh(){},refreshing:false}; }` }));
    } }]
});
const { default: tree } = await import(pathToFileURL(resolve(".build/preview/card.mjs")));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function html(node) {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(html).join("");
    if (typeof node !== "object") return escape(node);
    const attrs = Object.entries(node.props).filter(([key, value]) => !["children", "key"].includes(key) && !key.startsWith("on") && value !== false).map(([key, value]) => ` ${key === "className" ? "class" : key}="${escape(value)}"`).join("");
    return `<${node.tag}${attrs}>${html(node.children)}</${node.tag}>`;
}
const css = readFileSync("vencord/discordRichCards/styles.css", "utf8");
writeFileSync(".build/preview/index.html", `<!doctype html><meta charset="utf-8"><title>RichCards visual fixture</title><style>${css}\nbody{background:#313338;color:#ddd;font-family:Segoe UI,sans-serif;margin:32px;--font-primary:Segoe UI,sans-serif}.preview{max-width:720px}.narrow{width:320px;margin-top:28px}p{font-size:13px}</style><p>Visual fixture · actual renderer markup · sample data</p><div class="preview">${html(tree)}</div><div class="narrow">${html(tree)}</div>`);
console.log(resolve(".build/preview/index.html"));
