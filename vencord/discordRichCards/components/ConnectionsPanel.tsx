import "./connections.css";
import { useEffect, useState } from "@webpack/common";
import type { ConnectionInput, PublicConnection } from "../native";
import { Native } from "../settings";
import { notifyConnectionsChanged } from "../connectionsUi";

type Provider = "fivem" | "minecraft" | "dockhand" | "statuspage" | "spotify" | "twitch" | "steam" | "youtube" | "x";
type Draft = { id?: string; provider: Provider; name: string; config: Record<string, string | boolean>; hasCredential: boolean; };
type Result = { kind: "success" | "error"; message: string; } | null;

const providers: Array<{ value: Provider; label: string; }> = [
    { value: "fivem", label: "FiveM server" }, { value: "minecraft", label: "Minecraft server" },
    { value: "dockhand", label: "Dockhand" }, { value: "statuspage", label: "Statuspage service" },
    { value: "spotify", label: "Spotify" }, { value: "twitch", label: "Twitch" },
    { value: "steam", label: "Steam" }, { value: "youtube", label: "YouTube" }, { value: "x", label: "X" }
];

function blank(provider: Provider = "fivem"): Draft {
    const config: Draft["config"] = provider === "minecraft" ? { port: "25565" }
        : provider === "dockhand" ? { environmentId: "", containerNames: "" }
            : provider === "x" ? { allowPaidReads: false, maxRequestsPerHour: "10" }
                : provider === "steam" ? { country: "US" } : {};
    return { provider, name: "", config, hasCredential: false };
}

function draftFrom(connection: PublicConnection): Draft {
    const config = Object.fromEntries(Object.entries(connection.config).map(([key, value]) => [key,
        Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? value : String(value ?? "")
    ]));
    return { id: connection.id, provider: connection.provider as Provider, name: connection.name, config, hasCredential: connection.hasCredential };
}

function providerLabel(provider: string) {
    return providers.find(item => item.value === provider)?.label ?? provider;
}

function cleanMessage(value: unknown, fallback: string) {
    return typeof value === "string" && value.length <= 500 ? value : fallback;
}

export function ConnectionsPanel() {
    const [connections, setConnections] = useState<PublicConnection[]>([]);
    const [draft, setDraft] = useState<Draft>(() => blank());
    const [secret, setSecret] = useState("");
    const [dockhand, setDockhand] = useState({ username: "", password: "", mfaToken: "" });
    const [busy, setBusy] = useState<"" | "load" | "save" | "test" | "remove" | "connect" | "clear">("load");
    const [result, setResult] = useState<Result>(null);

    const load = async () => {
        setBusy("load");
        try {
            const response = await Native.listConnections();
            if (response.ok && Array.isArray(response.data)) {
                setConnections(response.data);
                setResult(null);
            } else {
                setResult({ kind: "error", message: cleanMessage(response.error, "Could not load saved connections.") });
            }
        } catch {
            setResult({ kind: "error", message: "Could not load saved connections." });
        } finally { setBusy(""); }
    };

    useEffect(() => { void load(); }, []);

    const disabled = busy !== "";
    const setConfig = (name: string, value: string | boolean) => setDraft(previous => ({ ...previous, config: { ...previous.config, [name]: value } }));
    const select = (connection: PublicConnection) => {
        if (disabled) return;
        setDraft(draftFrom(connection)); setSecret(""); setDockhand({ username: "", password: "", mfaToken: "" }); setResult(null);
    };
    const newConnection = () => {
        if (disabled) return;
        setDraft(blank()); setSecret(""); setDockhand({ username: "", password: "", mfaToken: "" }); setResult(null);
    };
    const changeProvider = (provider: Provider) => {
        setDraft(previous => ({ ...blank(provider), name: previous.name })); setSecret("");
    };

    const save = async () => {
        setBusy("save"); setResult(null);
        const config: Record<string, unknown> = { ...draft.config };
        if (draft.provider === "minecraft") config.port = Number(config.port);
        if (draft.provider === "dockhand") {
            config.environmentId = Number(config.environmentId);
            config.containerNames = String(config.containerNames ?? "").split(",").map(name => name.trim()).filter(Boolean);
        }
        if (draft.provider === "x") {
            config.maxRequestsPerHour = Number(config.maxRequestsPerHour);
            config.allowPaidReads = config.allowPaidReads === true;
        }
        const secretKey = draft.provider === "spotify" || draft.provider === "twitch" ? "clientSecret"
            : draft.provider === "youtube" ? "apiKey" : draft.provider === "x" ? "bearerToken" : "";
        const input: ConnectionInput = { ...(draft.id ? { id: draft.id } : {}), provider: draft.provider, name: draft.name, config,
            ...(secret.trim() && secretKey ? { secret: { [secretKey]: secret.trim() } } : {}) };
        try {
            const response = await Native.saveConnection(input);
            if (response.ok && response.data) {
                setDraft(draftFrom(response.data));
                setResult({ kind: "success", message: "Connection saved." });
                notifyConnectionsChanged();
                try {
                    const listed = await Native.listConnections();
                    if (listed.ok && Array.isArray(listed.data)) setConnections(listed.data);
                } catch { /* The save already succeeded; the next settings open reloads the list. */ }
            } else {
                setResult({ kind: "error", message: cleanMessage(response.error, "Could not save this connection.") });
            }
        } catch {
            setResult({ kind: "error", message: "Could not save this connection." });
        } finally { setSecret(""); setBusy(""); }
    };

    const testConnection = async () => {
        if (!draft.id) { setResult({ kind: "error", message: "Save this connection before testing it." }); return; }
        setBusy("test"); setResult(null);
        try {
            const response = await Native.testConnection(draft.id);
            setResult(response.ok ? { kind: "success", message: cleanMessage(response.data, "Connection test completed.") } : { kind: "error", message: cleanMessage(response.error, "Connection test failed.") });
        } catch {
            setResult({ kind: "error", message: "Connection test failed." });
        } finally { setBusy(""); }
    };

    const remove = async () => {
        if (!draft.id) return;
        setBusy("remove"); setResult(null);
        try {
            const response = await Native.removeConnection(draft.id);
            if (response.ok) {
                setConnections(previous => previous.filter(item => item.id !== draft.id));
                setDraft(blank()); setSecret(""); setDockhand({ username: "", password: "", mfaToken: "" });
                setResult({ kind: "success", message: "Connection removed." }); notifyConnectionsChanged();
            } else setResult({ kind: "error", message: cleanMessage(response.error, "Could not remove this connection.") });
        } catch {
            setResult({ kind: "error", message: "Could not remove this connection." });
        } finally { setBusy(""); }
    };

    const clearCredential = async () => {
        if (!draft.id || !draft.hasCredential) return;
        setBusy("clear"); setResult(null);
        try {
            const response = await Native.removeCredential(draft.id);
            if (response.ok && response.data) {
                const updated = draftFrom(response.data);
                setDraft(updated);
                setConnections(previous => previous.map(connection => connection.id === updated.id ? response.data! : connection));
                setResult({ kind: "success", message: draft.provider === "dockhand" ? "Dockhand disconnected." : "Credential cleared." });
                notifyConnectionsChanged();
            } else setResult({ kind: "error", message: cleanMessage(response.error, "Could not clear this credential.") });
        } catch {
            setResult({ kind: "error", message: "Could not clear this credential." });
        } finally {
            setSecret("");
            setDockhand(previous => ({ ...previous, password: "", mfaToken: "" }));
            setBusy("");
        }
    };

    const connectDockhand = async () => {
        if (!draft.id) { setResult({ kind: "error", message: "Save the Dockhand connection before signing in." }); return; }
        setBusy("connect"); setResult(null);
        try {
            const response = await Native.connectDockhand(draft.id, dockhand.username, dockhand.password, dockhand.mfaToken);
            if (response.ok) {
                setResult({ kind: "success", message: cleanMessage(response.data, "Dockhand connected.") }); notifyConnectionsChanged();
                try {
                    const listed = await Native.listConnections();
                    if (listed.ok && Array.isArray(listed.data)) {
                        setConnections(listed.data);
                        const updated = listed.data.find(connection => connection.id === draft.id);
                        if (updated) setDraft(draftFrom(updated));
                    }
                } catch { /* The encrypted session was saved; a later list refresh updates its badge. */ }
            } else setResult({ kind: "error", message: cleanMessage(response.error, "Could not connect to Dockhand.") });
        } catch {
            setResult({ kind: "error", message: "Could not connect to Dockhand." });
        } finally { setDockhand(previous => ({ ...previous, password: "", mfaToken: "" })); setBusy(""); }
    };

    const credentialLabel = draft.provider === "spotify" || draft.provider === "twitch" ? "Client secret"
        : draft.provider === "youtube" ? "API key" : draft.provider === "x" ? "Bearer token" : "";

    return <section className="rich-card-connections" aria-labelledby="rich-card-connections-title">
        <header>
            <h3 id="rich-card-connections-title" className="rich-card-connections-title">Connections</h3>
            <p className="rich-card-connections-lede">Saved profiles keep message markers private: viewers use only their own local setup. Credentials are encrypted by Discord’s native process and never shown here again.</p>
        </header>
        <div className="rich-card-connections-layout">
            <nav className="rich-card-connection-list" aria-label="Saved connections">
                {connections.map(connection => <button type="button" key={connection.id} className="rich-card-connection-item" aria-current={draft.id === connection.id} onClick={() => select(connection)} disabled={disabled}>
                    {connection.name}<small>{providerLabel(connection.provider)}{connection.hasCredential ? " · credential saved" : ""}</small>
                </button>)}
                <button type="button" className="rich-card-connection-new" onClick={newConnection} disabled={disabled}>+ New connection</button>
            </nav>
            <form className="rich-card-connection-form" onSubmit={event => { event.preventDefault(); void save(); }}>
                <div className="rich-card-connection-grid">
                    <label className="rich-card-connection-field"><span>Display name</span><input value={draft.name} onChange={event => { const name = event.currentTarget.value; setDraft(previous => ({ ...previous, name })); }} maxLength={80} required disabled={disabled} /></label>
                    <label className="rich-card-connection-field"><span>Provider</span><select value={draft.provider} onChange={event => changeProvider(event.currentTarget.value as Provider)} disabled={disabled || Boolean(draft.id)}>{providers.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select></label>
                    {renderProviderFields(draft, setConfig, disabled)}
                    {credentialLabel && <label className="rich-card-connection-field rich-card-connection-field--wide"><span>{credentialLabel}{draft.hasCredential ? " (saved; leave blank to keep)" : ""}</span><input type="password" value={secret} onChange={event => setSecret(event.currentTarget.value)} autoComplete="new-password" placeholder={draft.hasCredential ? "Leave blank to keep current credential" : "Enter credential"} disabled={disabled} /> </label>}
                </div>
                {draft.provider === "dockhand" && <p className="rich-card-connection-credential">Dockhand is local-network-only. If your instance has authentication disabled, save this profile and test the connection without logging in. Otherwise, use Connect Dockhand below; its session is stored by the native bridge.</p>}
                {credentialLabel && <p className="rich-card-connection-help">Credential fields are write-only. Saving a blank field preserves a credential when this connection’s address and configuration remain unchanged.</p>}
                {draft.provider === "x" && <p className="rich-card-connection-help">X reads can be billed. Background refresh is disabled; a posted card must be manually refreshed before its first paid read.</p>}
                {draft.provider === "steam" || draft.provider === "youtube" || draft.provider === "spotify" || draft.provider === "twitch" || draft.provider === "x" ? <p className="rich-card-connection-help">Test uses the last saved configuration and does not make a billed API request. Use a card preview to verify provider access.</p> : null}
                {draft.id && draft.provider === "dockhand" && <DockhandLogin values={dockhand} onChange={setDockhand} onSubmit={connectDockhand} disabled={disabled} />}
                <div className="rich-card-connection-actions"><button className="rich-card-connection-button rich-card-connection-button--primary" type="submit" disabled={disabled}>{busy === "save" ? "Saving…" : "Save"}</button><button className="rich-card-connection-button" type="button" onClick={testConnection} disabled={disabled || !draft.id}>{busy === "test" ? "Testing…" : "Test connection"}</button>{draft.id && draft.hasCredential && <button className="rich-card-connection-button" type="button" onClick={clearCredential} disabled={disabled}>{busy === "clear" ? "Clearing…" : draft.provider === "dockhand" ? "Disconnect" : "Clear credential"}</button>}{draft.id && <button className="rich-card-connection-button rich-card-connection-button--danger" type="button" onClick={remove} disabled={disabled}>{busy === "remove" ? "Removing…" : "Remove"}</button>}</div>
                <div className="rich-card-connection-result" data-kind={result?.kind} role="status" aria-live="polite">{result?.message ?? (busy === "load" ? "Loading connections…" : "")}</div>
            </form>
        </div>
    </section>;
}

function renderProviderFields(draft: Draft, setConfig: (name: string, value: string | boolean) => void, disabled: boolean) {
    const input = (name: string, label: string, options: { type?: string; placeholder?: string; wide?: boolean; required?: boolean; } = {}) => <label className={`rich-card-connection-field${options.wide ? " rich-card-connection-field--wide" : ""}`} key={name}><span>{label}</span><input type={options.type ?? "text"} value={String(draft.config[name] ?? "")} onChange={event => setConfig(name, event.currentTarget.value)} placeholder={options.placeholder} required={options.required ?? true} disabled={disabled} /></label>;
    switch (draft.provider) {
        case "fivem": return <>{input("baseUrl", "Server base URL", { placeholder: "https://status.example", wide: true })}{input("joinUrl", "Optional cfx.re join URL", { placeholder: "https://cfx.re/join/example", wide: true, required: false })}</>;
        case "minecraft": return <>{input("host", "Java server host", { placeholder: "mc.example.net" })}{input("port", "Port", { type: "number", placeholder: "25565" })}</>;
        case "dockhand": return <>{input("baseUrl", "Dockhand base URL", { placeholder: "http://192.168.1.10:3000", wide: true })}{input("environmentId", "Environment ID", { type: "number" })}{input("containerNames", "Container names (comma-separated)", { placeholder: "api, web", wide: true })}</>;
        case "statuspage": return <>{input("baseUrl", "Statuspage base URL", { placeholder: "https://status.example", wide: true })}</>;
        case "spotify": case "twitch": return <>{input("clientId", "Application client ID", { wide: true })}</>;
        case "steam": return <>{input("country", "Two-letter country", { placeholder: "US", wide: true })}</>;
        case "x": return <><label className="rich-card-connection-field"><span>Requests per hour</span><input type="number" min="1" max="100" value={String(draft.config.maxRequestsPerHour ?? "10")} onChange={event => setConfig("maxRequestsPerHour", event.currentTarget.value)} required disabled={disabled} /></label><label className="rich-card-connection-check rich-card-connection-field"><input type="checkbox" checked={draft.config.allowPaidReads === true} onChange={event => setConfig("allowPaidReads", event.currentTarget.checked)} disabled={disabled} />Allow paid X API reads</label></>;
        default: return null;
    }
}

function DockhandLogin({ values, onChange, onSubmit, disabled }: { values: { username: string; password: string; mfaToken: string; }; onChange: (next: { username: string; password: string; mfaToken: string; }) => void; onSubmit: () => void; disabled: boolean; }) {
    return <fieldset className="rich-card-connection-form"><legend>Connect Dockhand</legend><div className="rich-card-connection-grid"><label className="rich-card-connection-field"><span>Username</span><input value={values.username} onChange={event => onChange({ ...values, username: event.currentTarget.value })} autoComplete="username" disabled={disabled} /></label><label className="rich-card-connection-field"><span>Password</span><input type="password" value={values.password} onChange={event => onChange({ ...values, password: event.currentTarget.value })} autoComplete="current-password" disabled={disabled} /></label><label className="rich-card-connection-field rich-card-connection-field--wide"><span>MFA code (if required)</span><input inputMode="numeric" value={values.mfaToken} onChange={event => onChange({ ...values, mfaToken: event.currentTarget.value })} maxLength={8} disabled={disabled} /></label></div><div className="rich-card-connection-actions"><button type="button" className="rich-card-connection-button" onClick={onSubmit} disabled={disabled || !values.username || !values.password}>Connect Dockhand</button></div></fieldset>;
}
