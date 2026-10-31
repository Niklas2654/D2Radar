/**
 * Where a hover card (w × h) goes for the element at `at`: below it, else
 * above, else (too tall for either) beside it, right or left, kept in the
 * window – never over the element (and the pointer on it).
 */
export function placeCard(at: DOMRect, w: number, h: number, gap = 8): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centered = Math.min(Math.max(8, at.left + at.width / 2 - w / 2), vw - w - 8);
  if (at.bottom + gap + h <= vh - 8) return { left: centered, top: at.bottom + gap };
  if (at.top - gap - h >= 8) return { left: centered, top: at.top - gap - h };
  // Beside it, its top at the element's (as far as the window lets).
  const top = Math.min(Math.max(8, at.top), Math.max(8, vh - h - 8));
  if (at.right + gap + w <= vw - 8) return { left: at.right + gap, top };
  if (at.left - gap - w >= 8) return { left: at.left - gap - w, top };
  // No room anywhere: below, as much as fits.
  return { left: centered, top: Math.max(8, vh - h - 8) };
}
