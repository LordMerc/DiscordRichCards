// Shared by the bridge and renderer so cached events expire as time passes.
export function validRobloxEvent(event) {
    return !!event && typeof event === "object"
        && typeof event.id === "string" && /^[1-9][0-9]{0,19}$/.test(event.id)
        && typeof event.title === "string" && event.title.trim().length > 0 && event.title.length <= 200
        && typeof event.startsAt === "string" && Number.isFinite(Date.parse(event.startsAt))
        && typeof event.endsAt === "string" && Date.parse(event.endsAt) > Date.parse(event.startsAt);
}

export function currentRobloxEvents(events, now) {
    return events.filter(event => validRobloxEvent(event) && Date.parse(event.endsAt) > now)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

export function normalizeRobloxEvents(raw, universeId) {
    if (!raw || !Array.isArray(raw.data)
        || (raw.nextPageCursor != null && typeof raw.nextPageCursor !== "string")) {
        throw new Error("Invalid Roblox events response");
    }
    const events = [];
    for (const item of raw.data) {
        if (item?.universeId !== universeId || item.eventStatus !== "active" || item.eventVisibility !== "public") continue;
        const event = { id: item.id, title: item.title, startsAt: item.eventTime?.startUtc, endsAt: item.eventTime?.endUtc };
        if (!validRobloxEvent(event)) continue;
        events.push({ ...event, startsAt: new Date(event.startsAt).toISOString(), endsAt: new Date(event.endsAt).toISOString() });
    }
    return events;
}
