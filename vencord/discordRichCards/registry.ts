import type { ComponentType } from "react";
import type { RichCardDescriptor } from "./types";

export interface RichCardRenderer {
    provider: string;
    kind: string;
    validateReference(reference: string): boolean;
    enabled(): boolean;
    component: ComponentType<{ descriptor: RichCardDescriptor; }>;
}

const renderers = new Map<string, RichCardRenderer>();
export function registerRenderer(renderer: RichCardRenderer) {
    const key = `${renderer.provider}.${renderer.kind}`;
    if (renderers.has(key)) throw new Error(`Duplicate renderer: ${key}`);
    renderers.set(key, renderer);
}
export function getRenderer(descriptor: RichCardDescriptor) {
    return renderers.get(`${descriptor.provider}.${descriptor.kind}`);
}
