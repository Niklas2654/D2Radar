import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevron, IconWindows, Logo } from "../components/icons";
import { DOWNLOAD_URL, INSTALLER_SIZE, useDownloads, useGuardians, VERSION } from "../fx";
import { fill, useSiteLang, useStrings } from "../i18n";
import { SectionTitle } from "./Features";

export function HowItWorks() {
  const s = useStrings().how;
  return (
    <section id="how" className="relative mx-auto max-w-6xl px-5 py-24">
      <SectionTitle kicker={s.kicker} title={s.title} />
      <div className="mt-12 grid gap-3 md:grid-cols-3">
        {s.steps.map(({ title, text }, i) => (
          <div key={title} className="reveal glass p-6" style={{ ["--r" as string]: "16px", ["--delay" as string]: `${i * 0.08}s` }}>
            <div className="grid size-9 place-items-center rounded-full bg-(--accent-soft) font-display text-[15px] font-bold text-(--accent-text)">{i + 1}</div>
            <h3 className="mt-4 font-display text-[18px] font-semibold">{title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/55">{fill(text, { size: INSTALLER_SIZE })}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  const s = useStrings().faq;
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
  }, [s]);
  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-5 py-24">
      <SectionTitle kicker={s.kicker} title={s.title} />
      <div ref={list} className="mt-12 flex flex-col gap-2">
        {s.items.map(({ q, a }, i) => (
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
  const s = useStrings().download;
  const lang = useSiteLang();
  const live = [
    { n: useDownloads(), text: s.downloads },
    { n: useGuardians(), text: s.guardians },
  ];
  return (
    <section id="download" className="relative mx-auto max-w-6xl px-5 py-24">
      <div className="reveal glass px-6 py-16 text-center sm:px-16" style={{ ["--r" as string]: "24px" }}>
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/[0.05]">
          <Logo size={30} />
        </div>
        <h2 className="headline mt-6 font-display text-[36px] leading-tight font-bold tracking-tight sm:text-[52px]">
          {s.title} <span className="accent-word">{s.titleAccent}</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[16px] text-white/55">{s.text}</p>
        <a href={DOWNLOAD_URL} download className="btn-primary mt-9 inline-flex h-13 items-center gap-3 rounded-2xl px-7 text-[16px] font-semibold">
          <IconWindows /> {s.button}
        </a>
        <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12.5px] text-white/45">
          {[fill(s.version, { version: VERSION }), fill(s.installer, { size: INSTALLER_SIZE }), s.windows, s.free].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className="text-(--accent-text) [&_svg]:size-3.5">
                <IconCheck />
              </span>
              {t}
            </span>
          ))}
          {/* Counted live (api/downloads.ts, api/stats.ts): a dot instead of the tick. */}
          {live.map(
            ({ n, text }) =>
              !!n && (
                <span key={text} className="inline-flex items-center gap-1.5" title={s.downloadsLive}>
                  <span className="grid size-3.5 place-items-center">
                    <span className="size-1.5 animate-pulse rounded-full bg-(--accent-text)" />
                  </span>
                  <span className="tabular-nums">{fill(text, { n: n.toLocaleString(lang) })}</span>
                </span>
              ),
          )}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  const s = useStrings().footer;
  return (
    <footer className="relative mx-auto max-w-6xl px-5 pt-8 pb-12">
      <div className="flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 text-[12.5px] text-white/35 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="neon-title font-display text-[11px] font-semibold tracking-[0.42em]">RADAR</span>
          <span className="ml-2">© {new Date().getFullYear()}</span>
          <a href="/impressum" className="ml-3 hover:text-white/70">
            {s.legal}
          </a>
          <a href="/privacy" className="hover:text-white/70">
            {s.privacy}
          </a>
        </div>
        <p className="text-center sm:text-right">
          {s.disclaimer}
        </p>
      </div>
    </footer>
  );
}
