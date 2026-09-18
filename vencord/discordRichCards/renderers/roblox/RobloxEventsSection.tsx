import { useEffect, useState } from "@webpack/common";
import { currentRobloxEvents } from "../../bridge/robloxEvents.mjs";
import { CardSection } from "../../components/CardSection";
import type { RobloxEvent, RobloxGame } from "./types";

const localTime = (value: string) => new Date(value).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
});

function EventList({ events, now }: { events: RobloxEvent[]; now: number; }) {
    return <ul className="rich-card-events">
        {events.map(event => {
            const live = Date.parse(event.startsAt) <= now;
            return <li key={event.id} className="rich-card-event">
                <div className="rich-card-event-heading">
                    <span className="rich-card-event-status" data-live={live}>{live ? "Live now" : "Upcoming"}</span>
                    <span className="rich-card-event-title">{event.title}</span>
                </div>
                <div className="rich-card-event-time">
                    <div className="rich-card-event-date-line">
                        <span className="rich-card-event-date-label">Starts</span>
                        <time dateTime={event.startsAt}>{localTime(event.startsAt)}</time>
                    </div>
                    <div className="rich-card-event-date-line">
                        <span className="rich-card-event-date-label">Ends</span>
                        <time dateTime={event.endsAt}>{localTime(event.endsAt)}</time>
                    </div>
                </div>
            </li>;
        })}
    </ul>;
}

export function RobloxEventsSection({ data }: { data: RobloxGame; }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        // Update live/upcoming/ended states even when upstream data is cached or offline.
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    const events: RobloxEvent[] = currentRobloxEvents(data.events ?? [], now);
    if (!events.length && (!data.eventsStatus || data.eventsStatus === "ready") && !data.eventsTruncated) return null;
    return <CardSection title="Events">
        {data.eventsStatus === "unavailable" && <p className="rich-card-section-notice" role="status">Events are temporarily unavailable.</p>}
        {data.eventsStatus === "stale" && <p className="rich-card-section-notice" role="status">Events could not be refreshed. Previously fetched schedules may have changed.</p>}
        <EventList events={events.slice(0, 3)} now={now} />
        {events.length > 3 && <details className="rich-card-events-more">
            <summary>More events ({events.length - 3})</summary>
            <EventList events={events.slice(3)} now={now} />
        </details>}
        {data.eventsTruncated && <p className="rich-card-section-notice">More events may be available on the Roblox game page.</p>}
    </CardSection>;
}
