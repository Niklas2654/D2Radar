import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevron, IconWindows, Logo } from "../components/icons";
import { DOWNLOAD_URL, INSTALLER_SIZE, VERSION } from "../fx";
import { SectionTitle } from "./Features";

const STEPS = [
  ["Download", `Grab the installer (${INSTALLER_SIZE}). No admin rights needed.`],
  ["Connect Bungie", "Log in with your Bungie account once – no keys, nothing to set up."],
  ["Launch Destiny 2", "Radar comes up with the game in borderless mode. F10 opens what you look at, F6 Discord, F7 DIM."],
];

export function HowItWorks() {
  return (
    <section id="how" className="relative mx-auto max-w-6xl px-5 py-24">
      <SectionTitle kicker="How it works" title="Up in a few minutes." />
      <div className="mt-12 grid gap-3 md:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <div key={title} className="reveal glass p-6" style={{ ["--r" as string]: "16px", ["--delay" as string]: `${i * 0.08}s` }}>
            <div className="grid size-9 place-items-center rounded-full bg-(--accent-soft) font-display text-[15px] font-bold text-(--accent-text)">{i + 1}</div>
            <h3 className="mt-4 font-display text-[18px] font-semibold">{title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/55">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const FAQ = [
  [
    "Can I get banned for using Radar?",
    "Radar doesn't inject anything, doesn't read the game's memory and never sends input to Destiny 2. It reads what is on your screen (like a screenshot) and talks to Bungie's official API — the same way DIM and other companion apps do.",
  ],
  ["Is it free?", "Yes. Radar is free to download and use."],
  [
    "What does the Bungie login do?",
    "You log in on Bungie's own page – Radar never sees your password. It lets Radar read your vault and inventory and move or equip your gear. The login stays on your PC.",
  ],
  [
    "Does the overlay cost FPS?",
    "A little, as any window over a game does. Radar keeps it as small as it can: the overlay only covers the part of the screen its widgets are in, reads the screen only when something changed, and puts DIM and Discord to sleep while they're hidden. You can turn the overlay off and keep everything else.",
  ],
  [
    "Does it work with any Guardian name?",
    "Radar reads names with its own recognition, built in — no language packs to install. Symbols, Cyrillic and CJK names included. If a name is too fancy to read, you can still look the player up by hand.",
  ],
  ["Which platforms?", "Windows 10 and 11, with Destiny 2 on Steam or the Epic Games Store in borderless window mode."],
  [
    "Is Radar made by Bungie?",
    "No. Radar is a fan-made companion app and is not affiliated with or endorsed by Bungie. Destiny is a trademark of Bungie, Inc.",
  ],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  // Room for the longest answer kept from the start: one opening or closing
  // doesn't push what's under the list up and down.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const fit = () => {
      const items = [...el.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      // Every question closed, plus the tallest answer.
      const closed = items.reduce((sum, item) => sum + (item.firstElementChild as HTMLElement).offsetHeight + 2, 0);
      const answer = Math.max(...items.map((item) => item.querySelector("p")?.offsetHeight ?? 0));
      el.style.minHeight = `${closed + gap * (items.length - 1) + answer}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-5 py-24">
      <SectionTitle kicker="FAQ" title="Questions, answered." />
      <div ref={list} className="mt-12 flex flex-col gap-2">
        {FAQ.map(([q, a], i) => (
          <div key={q} className="reveal glass overflow-hidden" style={{ ["--r" as string]: "14px", ["--delay" as string]: `${i * 0.04}s` }}>
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
              <span className="font-display text-[15.5px] font-semibold">{q}</span>
              <span className={`shrink-0 text-white/45 transition-transform duration-300 ${open === i ? "rotate-180" : ""}`}>
                <IconChevron />
              </span>
            </button>
            <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}>
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-[14px] leading-relaxed text-white/60">{a}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Download() {
  return (
    <section id="download" className="relative mx-auto max-w-6xl px-5 py-24">
      <div className="reveal glass px-6 py-16 text-center sm:px-16" style={{ ["--r" as string]: "24px" }}>
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/[0.05]">
          <Logo size={30} />
        </div>
        <h2 className="headline mt-6 font-display text-[36px] leading-tight font-bold tracking-tight sm:text-[52px]">
          Ready when you are, <span className="accent-word">Guardian.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[16px] text-white/55">Download Radar, launch Destiny 2, and everything is there when you land in orbit.</p>
        <a href={DOWNLOAD_URL} download className="btn-primary mt-9 inline-flex h-13 items-center gap-3 rounded-2xl px-7 text-[16px] font-semibold">
          <IconWindows /> Download for Windows
        </a>
        <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12.5px] text-white/45">
          {[`Version ${VERSION}`, `${INSTALLER_SIZE} installer`, "Windows 10 / 11", "Free"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="text-(--accent-text) [&_svg]:size-3.5">
                <IconCheck />
              </span>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative mx-auto max-w-6xl px-5 pt-8 pb-12">
      <div className="flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 text-[12.5px] text-white/35 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="neon-title font-display text-[11px] font-semibold tracking-[0.42em]">RADAR</span>
          <span className="ml-2">© {new Date().getFullYear()}</span>
          <a href="/impressum" className="ml-3 hover:text-white/70">
            Legal notice
          </a>
          <a href="/privacy" className="hover:text-white/70">
            Privacy
          </a>
        </div>
        <p className="text-center sm:text-right">
          Not affiliated with Bungie. Destiny 2 is a trademark of Bungie, Inc.
        </p>
      </div>
    </footer>
  );
}
