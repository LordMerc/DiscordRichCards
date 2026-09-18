let revision = 0;
const listeners = new Set<() => void>();

export function notifyConnectionsChanged() {
    revision++;
    for (const listener of listeners) listener();
}

export function getConnectionsRevision() {
    return revision;
}

export function subscribeConnections(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
