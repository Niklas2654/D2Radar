import { useEffect, useState } from "react";
import { IconDownload, Logo } from "../components/icons";

const LINKS = [
  { href: "#tour", label: "Tour" },
  { href: "#features", label: "Features" },
  { href: "#safety", label: "Safety" },
  { href: "#faq", label: "FAQ" },
];

/** The bar at the top: logo, the sections, download. Plain until scrolled,
 *  then a dark field under it. */
export function Header() {
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
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <a href="#download" className="btn-primary ml-auto inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold md:ml-0">
          <IconDownload /> Download
        </a>
      </div>
    </header>
  );
}
