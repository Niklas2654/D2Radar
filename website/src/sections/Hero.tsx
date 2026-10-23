import { IconArrow, IconWindows } from "../components/icons";
import { DOWNLOAD_URL, INSTALLER_SIZE, VERSION } from "../fx";

/** Above the fold: the slogan, what Radar is, and the download; the
 *  showcase fades in below once the page is scrolled. */
export function Hero() {
  return (
    <section id="top" className="relative mx-auto flex min-h-[92svh] max-w-5xl flex-col items-center justify-center px-5 pt-24 pb-16 text-center">
      <div className="reveal inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-medium text-white/70">
        <span className="size-1.5 rounded-full bg-(--accent)" />
        Free for Windows · v{VERSION}
      </div>
      <h1
        className="reveal headline mt-6 font-display text-[42px] leading-[1.04] font-bold tracking-tight sm:text-[60px] lg:text-[72px]"
        style={{ ["--delay" as string]: "0.06s" }}
      >
        See what the game
        <br />
        <span className="accent-word">won't tell you.</span>
      </h1>
      <p className="reveal mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-white/60" style={{ ["--delay" as string]: "0.12s" }}>
        Everything about your Guardian, right next to the game. Radar recognises the weapon, armor or Guardian you're
        looking at and shows what the game doesn't: every roll, exact numbers, clears, lowmans and builds. Plus loadouts,
        DIM and Discord one hotkey away.
      </p>
      <div className="reveal mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ ["--delay" as string]: "0.18s" }}>
        <a href={DOWNLOAD_URL} className="btn-primary inline-flex h-12 items-center gap-2.5 rounded-2xl px-6 text-[15px] font-semibold" download>
          <IconWindows /> Download for Windows
        </a>
        <a href="#features" className="btn-ghost inline-flex h-12 items-center gap-2 rounded-2xl px-5 text-[15px] font-medium">
          See all features <IconArrow />
        </a>
      </div>
      <p className="reveal mt-4 text-[12px] text-white/35" style={{ ["--delay" as string]: "0.24s" }}>
        {INSTALLER_SIZE} · Windows 10/11 · Not affiliated with Bungie
      </p>
      <a
        href="#tour"
        className="reveal absolute bottom-6 flex flex-col items-center gap-1 text-[12px] text-white/35 transition-colors hover:text-white/70"
        style={{ ["--delay" as string]: "0.4s" }}
      >
        See it in action
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </a>
    </section>
  );
}
