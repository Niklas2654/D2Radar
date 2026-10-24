import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevron, IconDownload, IconGlobe, Logo } from "../components/icons";
import { setSiteLang, SITE_LANGUAGES, useSiteLang, useStrings, type SiteLang } from "../i18n";

/** The site's language: a button with the code, and a list of the
 *  languages on dark glass under it (the browser's own select list can't be
 *  styled: on Windows it comes up white). */
export function LanguagePicker() {
  const lang = useSiteLang();
  const s = useStrings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Closed by a click elsewhere or Escape; opened, the current one has focus.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...(list.current?.querySelectorAll("button") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    list.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const pick = (l: SiteLang) => {
    setSiteLang(l);
    setOpen(false);
  };
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={s.nav.language}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] transition-colors hover:bg-white/[0.06] hover:text-white ${open ? "bg-white/[0.06] text-white" : "text-white/60"}`}
      >
        <IconGlobe />
        <span className="font-semibold uppercase">{lang}</span>
        <span className={`transition-transform duration-200 [&_svg]:size-3.5 ${open ? "rotate-180" : ""}`}>
          <IconChevron />
        </span>
      </button>
      {open && (
        <ul
          ref={list}
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-56 rounded-2xl border border-white/[0.08] bg-[#0b0c12]/95 p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
        >
          {SITE_LANGUAGES.map((l) => {
            const active = l.id === lang;
            return (
              <li key={l.id}>
                <button
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => pick(l.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07] ${active ? "text-white" : "text-white/65"}`}
                >
                  <span className="w-6 text-[11px] font-semibold tracking-wide text-white/35 uppercase">{l.id}</span>
                  <span className="flex-1">{l.label}</span>
                  {active && (
                    <span className="text-(--accent-text) [&_svg]:size-4">
                      <IconCheck />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The bar at the top: logo, the sections, download. Plain until scrolled,
 *  then a dark field under it. */
export function Header() {
  const s = useStrings();
  const links = [
    { href: "#tour", label: s.nav.tour },
    { href: "#features", label: s.nav.features },
    { href: "#safety", label: s.nav.safety },
    { href: "#faq", label: s.nav.faq },
  ];
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        scrolled ? "border-white/[0.06] bg-[#05060a]/90 backdrop-blur-md" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo />
          <span className="neon-title font-display text-[13px] font-semibold tracking-[0.42em]">RADAR</span>
        </a>
        <nav className="hidden flex-1 items-center justify-center gap-7 text-[13.5px] text-white/60 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <LanguagePicker />
          <a href="#download" className="btn-primary inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold">
            <IconDownload /> {s.nav.download}
          </a>
        </div>
      </div>
    </header>
  );
}
