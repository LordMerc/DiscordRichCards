import type { ReactNode } from "react";

export function CardShell({ children, status = "queued", className = "" }: { children: ReactNode; status?: string; className?: string; }) {
    return <div className={`hermes-live-card rich-card ${className}`} data-status={status}>{children}</div>;
}

export function CardError({ message }: { message: string; }) {
    return <CardShell status="error"><div className="hermes-live-error" role="status">{message}</div></CardShell>;
}
