import net from "node:net";

function varint(value) {
    const bytes = [];
    do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value);
    return Buffer.from(bytes);
}
function readVarint(buffer, offset = 0) {
    let result = 0;
    for (let i = 0; i < 5; i++) {
        if (offset + i >= buffer.length) return null;
        const byte = buffer[offset + i];
        result += (byte & 127) * 2 ** (7 * i);
        if (!(byte & 128)) return { value: result, next: offset + i + 1 };
    }
    throw new Error("Invalid Minecraft response");
}

export function minecraftStatus({ host, port = 25565 }, { signal } = {}) {
    return new Promise((resolve, reject) => {
        if (typeof host !== "string" || host.length > 253 || !host || /[\s/\\@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
            reject(new Error("Invalid Minecraft address")); return;
        }
        if (signal?.aborted) { reject(new Error("Minecraft request cancelled")); return; }
        let buffer = Buffer.alloc(0);
        let settled = false;
        const socket = net.createConnection({ host, port });
        const finish = (error, data) => {
            if (settled) return;
            settled = true; clearTimeout(timer); socket.destroy();
            signal?.removeEventListener("abort", abort);
            if (error) reject(error); else resolve(data);
        };
        const abort = () => finish(new Error("Minecraft request cancelled"));
        const timer = setTimeout(() => finish(new Error("Minecraft server did not respond")), 8000);
        signal?.addEventListener("abort", abort, { once: true });
        socket.on("connect", () => {
            const address = Buffer.from(host);
            const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
            const handshake = Buffer.concat([Buffer.from([0]), varint(0xffffffff), varint(address.length), address, portBytes, Buffer.from([1])]);
            socket.write(Buffer.concat([varint(handshake.length), handshake, Buffer.from([1, 0])]));
        });
        socket.on("data", chunk => {
            if (buffer.length + chunk.length > 1024 * 1024) { finish(new Error("Minecraft response exceeds size limit")); return; }
            buffer = Buffer.concat([buffer, chunk]);
            try {
                const packet = readVarint(buffer);
                if (!packet) return;
                if (packet.value > 1024 * 1024 || packet.value < 2) throw new Error();
                if (buffer.length < packet.next + packet.value) return;
                const id = readVarint(buffer, packet.next);
                if (!id || id.value !== 0) throw new Error();
                const json = readVarint(buffer, id.next);
                if (!json || json.value < 2 || json.next + json.value !== packet.next + packet.value) throw new Error();
                const data = JSON.parse(buffer.subarray(json.next, json.next + json.value).toString("utf8"));
                if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
                finish(null, data);
            } catch { finish(new Error("Invalid Minecraft status response")); }
        });
        socket.on("error", () => finish(new Error("Minecraft server unavailable")));
        socket.on("end", () => { if (!settled) finish(new Error("Minecraft server returned incomplete status")); });
    });
}
