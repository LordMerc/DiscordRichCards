export interface RobloxGame {
    iconUrl?: string | null;
    thumbnailUrl?: string | null;
    placeId: number;
    universeId: number;
    name: string;
    creator: string;
    playing: number | null;
    favorites: number | null;
    visits: number | null;
    status: "open" | "private" | "locked" | "unknown";
    statusReason: string;
    updatedAt: string;
}
