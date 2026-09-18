import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import net from "node:net";
import { requestJson, isPrivateAddress } from "../vencord/discordRichCards/bridge/transport.mjs";
import { minecraftStatus } from "../vencord/discordRichCards/bridge/minecraft.mjs";

test("bounded native HTTP reads reject redirects, excess bytes and nonlocal Dockhand destinations", async t => {
    const server = http.createServer((req, res) => {
        if (req.url === "/redirect") { res.writeHead(302, { Location: "http://example.com" }); res.end(); }
        else if (req.url === "/large") res.end('"' + "a".repeat(1024 * 1024 + 1) + '"');
        else { res.setHeader("set-cookie", "dockhand_session=sample; HttpOnly"); res.end('{"ok":true}'); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const result = await requestJson(base, { localOnly: true });
    assert.deepEqual(result.data, { ok: true });
    assert.match(result.headers.get("set-cookie"), /dockhand_session/);
    await assert.rejects(requestJson(base + "/redirect", { headers: { Authorization: "secret" } }), /redirect/i);
    await assert.rejects(requestJson(base + "/large"), /limit/i);
    await assert.rejects(requestJson("http://8.8.8.8/", { localOnly: true }), /local network/i);
    for (const address of ["127.0.0.1", "10.2.3.4", "192.168.1.2", "172.31.0.1", "::1", "fd00::1"]) assert.equal(isPrivateAddress(address), true);
    for (const address of ["8.8.8.8", "172.32.0.1", "0.0.0.0", "::", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(address), false);
});

test("Java server ping consumes a fragmented bounded status packet without account credentials", async t => {
    const payload = { description: { text: "Test world" }, version: { name: "1.21", protocol: 767 }, players: { online: 3, max: 20 } };
    const bytes = Buffer.from(JSON.stringify(payload));
    const varint = value => { const values = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; values.push(byte); } while (value); return Buffer.from(values); };
    const body = Buffer.concat([Buffer.from([0]), varint(bytes.length), bytes]);
    const packet = Buffer.concat([varint(body.length), body]);
    const server = net.createServer(socket => socket.once("data", () => {
        socket.write(packet.subarray(0, 2));
        setTimeout(() => socket.end(packet.subarray(2)), 5);
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    assert.deepEqual(await minecraftStatus({ host: "127.0.0.1", port: server.address().port }), payload);
});
