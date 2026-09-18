import { randomBytes } from "node:crypto";
import { createBridge } from "./runtime.mjs";

// Owned by the Electron main process. Neither the random port nor token is sent to React.
export function createManagedBridge({ dataFile, githubToken = "", fetch = globalThis.fetch, providerOptions = {} }) {
    let enabled = false;
    /** @type {{ bridge: ReturnType<typeof createBridge>, connection: { url: string, token: string } } | undefined} */
    let active;
    let operation = Promise.resolve();

    /** @template T @param {() => Promise<T>} action @returns {Promise<T>} */
    function serial(action) {
        const result = operation.then(action);
        operation = result.then(() => undefined, () => undefined);
        return result;
    }

    /** @returns {Promise<{ url: string, token: string }>} */
    async function ensure() {
        if (!enabled) throw new Error("Built-in bridge is disabled");
        if (active) return active.connection;
        const token = randomBytes(32).toString("hex");
        const bridge = createBridge({ env: {}, host: "127.0.0.1", port: 0, token, githubToken, dataFile, fetch, providerOptions });
        await bridge.listen();
        if (!enabled) {
            await bridge.close();
            throw new Error("Built-in bridge is disabled");
        }
        bridge.server.unref();
        active = { bridge, connection: { url: `http://127.0.0.1:${bridge.port}`, token } };
        return active.connection;
    }

    return {
        start() { enabled = true; return serial(ensure); },
        connection() { return serial(ensure); },
        stop() {
            enabled = false;
            return serial(async () => {
                const previous = active;
                active = undefined;
                if (previous) await previous.bridge.close();
            });
        }
    };
}
