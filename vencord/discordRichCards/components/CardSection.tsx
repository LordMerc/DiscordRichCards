import type { ReactNode } from "react";

/** Optional card features compose here; data fetching stays with their provider. */
export function CardSection({ title, children }: { title: string; children: ReactNode; }) {
    return <section className="rich-card-section" aria-label={title}>
        <h3 className="rich-card-section-title">{title}</h3>
        {children}
    </section>;
}
