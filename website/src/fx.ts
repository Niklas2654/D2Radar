import { useEffect } from "react";

/** Sections and cards fade up into view as they are scrolled to (.reveal). */
export function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            observer.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () => document.querySelectorAll(".reveal:not(.in)").forEach((el) => observer.observe(el));
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
}

/** Where the Windows installer is: the newest release of the public
 *  D2Radar repo (published by `pnpm release`, always under this name). */
export const DOWNLOAD_URL = "https://github.com/Niklas2654/D2Radar/releases/latest/download/Radar-setup.exe";
/** The released version and the installer's size, as shown on the page
 *  (set by the release workflow, .github/workflows/release.yml). */
export const VERSION: string = import.meta.env.VITE_RADAR_VERSION ?? "0.1.0";
export const INSTALLER_SIZE: string = import.meta.env.VITE_INSTALLER_SIZE ?? "38 MB";

/** The site's colour, picked in the demo's settings (Void until then),
 *  kept in this browser so the site always comes up in it. */
const ACCENT_KEY = "radar.site.accent";
/** Fired on window with the new SiteAccent (the carousel's pictures follow). */
export const ACCENT_EVENT = "radar:site-accent";

export interface SiteAccent {
  /** The demo's accent id ("void", "stasis", …) or a "#rrggbb" of its own. */
  accent: string;
  color: string;
}

export function savedAccent(): SiteAccent | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCENT_KEY) ?? "null") as SiteAccent | null;
    return v && /^#[0-9a-f]{6}$/i.test(v.color) ? v : null;
  } catch {
    return null;
  }
}

/** Colour the site (its tokens derive from --accent) and remember it. */
export function applyAccent(a: SiteAccent, remember = true) {
  document.documentElement.style.setProperty("--accent", a.color);
  window.dispatchEvent(new CustomEvent<SiteAccent>(ACCENT_EVENT, { detail: a }));
  if (!remember) return;
  try {
    localStorage.setItem(ACCENT_KEY, JSON.stringify(a));
  } catch {
    // Storage blocked: the colour lasts for this visit.
  }
}
