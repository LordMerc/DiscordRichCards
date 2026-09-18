import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectionStore, hasSecureStorage } from "../vencord/discordRichCards/bridge/connections.mjs";

function fixture(t, available = true) {
    const dir = mkdtempSync(join(tmpdir(), "richcards-connections-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "connections.json");
    // Opaque reversible fake for unit tests; production uses Electron safeStorage.
    const options = { file, isEncryptionAvailable: () => available,
        encrypt: text => Buffer.from(text.split("").reverse().join("")),
        decrypt: bytes => bytes.toString().split("").reverse().join("") };
    return { file, options, store: createConnectionStore(options) };
}

test("profiles persist encrypted secrets, expose only configured flags and clear credentials on destination changes", t => {
    const { store, file, options } = fixture(t);
    const profile = store.save({ provider: "twitch", name: "Streams", config: { clientId: "client-a" }, secret: { clientSecret: "private-value" } });
    assert.equal(profile.hasCredential, true);
    assert.equal(JSON.stringify(store.list()).includes("private-value"), false);
    assert.equal(readFileSync(file, "utf8").includes("private-value"), false);
    assert.equal(createConnectionStore(options).get(profile.id).secret.clientSecret, "private-value");
    store.save({ ...profile, name: "Renamed" });
    assert.equal(store.get(profile.id).secret.clientSecret, "private-value");
    const revision = store.revision;
    store.save({ ...profile, config: { clientId: "different-client" } });
    assert.deepEqual(store.get(profile.id).secret, {});
    assert.ok(store.revision > revision);
    assert.equal(store.get("unknown"), null);
    store.remove(profile.id);
    assert.equal(store.integration("twitch"), null);
});

test("encryption unavailable and corrupt persisted storage fail closed without overwriting data", t => {
    const { store, file, options } = fixture(t, false);
    assert.throws(() => store.save({ provider: "youtube", name: "Videos", config: {}, secret: { apiKey: "secret" } }), /encryption/i);
    writeFileSync(file, '{"version":1,"profiles":"broken"}');
    const broken = createConnectionStore(options);
    assert.throws(() => broken.list(), /stored connections/i);
    assert.throws(() => broken.save({ provider: "steam", name: "Store", config: { country: "US" } }), /stored connections/i);
    assert.equal(readFileSync(file, "utf8"), '{"version":1,"profiles":"broken"}');
});

test("connection schemas reject arbitrary operations and renderer-supplied Dockhand sessions", t => {
    const { store } = fixture(t);
    assert.throws(() => store.save({ provider: "dockhand", name: "LAN", config: { baseUrl: "http://user:password@localhost", environmentId: 1, containerNames: [] } }), /address/i);
    assert.throws(() => store.save({ provider: "fivem", name: "Server", config: { baseUrl: "http://localhost/api/delete" } }), /address/i);
    assert.throws(() => store.save({ provider: "dockhand", name: "LAN", config: { baseUrl: "http://localhost:3000", environmentId: 1, containerNames: [] }, secret: { session: "injected" } }), /credential/i);
    const dock = store.save({ provider: "dockhand", name: "LAN", config: { baseUrl: "http://localhost:3000", environmentId: 1, containerNames: ["web"] } });
    store.setSecret(dock.id, { session: "native-session" });
    assert.equal(store.get(dock.id).secret.session, "native-session");
    assert.equal(store.list()[0].hasCredential, true);
    assert.throws(() => store.save({ provider: "x", name: "Posts", config: { allowPaidReads: true, maxRequestsPerHour: 0 } }), /budget/i);
});

test("Linux basic_text backend cannot save or load credentials and preserves the previous file", t => {
    const { store, file, options } = fixture(t);
    const saved = store.save({ provider: "youtube", name: "Videos", config: {}, secret: { apiKey: "private" } });
    const before = readFileSync(file, "utf8");
    const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" };
    assert.equal(hasSecureStorage(storage, "linux"), false);
    const weak = createConnectionStore({ ...options, isEncryptionAvailable: () => hasSecureStorage(storage, "linux") });
    assert.throws(() => weak.get(saved.id), /stored connections/);
    assert.throws(() => weak.save({ ...saved, secret: { apiKey: "new" } }), /stored connections/);
    assert.equal(readFileSync(file, "utf8"), before);
});

test("paid X budget survives store recreation and clearing credentials preserves the profile ID", t => {
    const { store, options } = fixture(t);
    const saved = store.save({ provider: "x", name: "Posts", config: { allowPaidReads: true, maxRequestsPerHour: 1 }, secret: { bearerToken: "secret-token" } });
    assert.equal(store.consumeXRequest(1, 10_000), true);
    const reopened = createConnectionStore(options);
    assert.equal(reopened.consumeXRequest(1, 20_000), false);
    assert.equal(reopened.consumeXRequest(1, 3_610_001), true);
    const cleared = reopened.clearSecret(saved.id);
    assert.equal(cleared.id, saved.id);
    assert.equal(cleared.hasCredential, false);
    assert.deepEqual(reopened.get(saved.id).secret, {});
});
