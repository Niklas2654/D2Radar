import { useEffect, useState } from "react";
import { call, hasBackend } from "./tauri";

/** One piece of a Clarity line: text, maybe styled (element, bold, …). */
export interface ClarityPiece {
  text?: string;
  classNames?: string[];
  link?: string;
}
/** A line of a description, or a spacer between paragraphs. */
export interface ClarityBlock {
  linesContent?: ClarityPiece[];
  classNames?: string[];
}
export type ClarityText = ClarityBlock[];

export const CLARITY_SITE = "https://d2clarity.com";
export const CLARITY_DISCORD = "https://d2clarity.com/discord";

/** Already fetched per perk hash (null: Clarity has nothing for it). */
const known = new Map<number, ClarityText | null>();

/** Clarity's exact descriptions for these perks (fetched once each). */
export function useClarity(hashes: number[]): Map<number, ClarityText> {
  const key = [...new Set(hashes)].sort().join(",");
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!hasBackend) return;
    const missing = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((h) => !known.has(h));
    if (missing.length === 0) return;
    let alive = true;
    void call<Record<string, ClarityText>>("clarity_perks", { hashes: missing })
      .then((found) => {
        for (const h of missing) known.set(h, found?.[h] ?? null);
        if (alive) rerender((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  const out = new Map<number, ClarityText>();
  for (const h of hashes) {
    const text = known.get(h);
    if (text) out.set(h, text);
  }
  return out;
}

/** Clarity's entry for an item's own perk (an exotic armor piece's). */
export interface ClarityItemPerk {
  name: string;
  text: ClarityText;
}

/** Already fetched per item hash (empty: Clarity has nothing for it). */
const knownItems = new Map<number, ClarityItemPerk[]>();

/** Clarity's exact numbers for these items' own perks (exotic armor). */
export function useClarityItems(hashes: number[]): Map<number, ClarityItemPerk[]> {
  const key = [...new Set(hashes)].sort().join(",");
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!hasBackend) return;
    const missing = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((h) => !knownItems.has(h));
    if (missing.length === 0) return;
    let alive = true;
    void call<Record<string, ClarityItemPerk[]>>("clarity_items", { hashes: missing })
      .then((found) => {
        for (const h of missing) knownItems.set(h, found?.[h] ?? []);
        if (alive) rerender((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  const out = new Map<number, ClarityItemPerk[]>();
  for (const h of hashes) {
    const list = knownItems.get(h);
    if (list?.length) out.set(h, list);
  }
  return out;
}
