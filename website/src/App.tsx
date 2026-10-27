import { useEffect, useRef, useState } from "react";
import { useReveal } from "./fx";
import { Features, Safety } from "./sections/Features";
import { Header } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { Legal, type LegalPage } from "./sections/Legal";
import { Download, Faq, Footer, HowItWorks } from "./sections/Rest";
import { Tour } from "./sections/Tour";

/** The legal pages' addresses (vercel.json sends them to the site too). */
const LEGAL_PATHS: Record<LegalPage, string> = { impressum: "/impressum", datenschutz: "/privacy" };

/** The legal page the address points to, if any. */
function legalPage(): LegalPage | null {
  const path = location.pathname.replace(/\/+$/, "");
  return path === "/impressum" ? "impressum" : path === "/privacy" || path === "/datenschutz" ? "datenschutz" : null;
}

// Old links (#impressum, #datenschutz): to the pages' own addresses.
{
  const hash = location.hash.slice(1);
  if (hash === "impressum" || hash === "datenschutz") history.replaceState(null, "", LEGAL_PATHS[hash]);
}

/** Smoothly to a section (the top for "top"), the address left clean. */
function scrollToSection(id: string) {
  const el = id === "top" ? null : document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

export function App() {
  const [legal, setLegal] = useState(legalPage);
  // A section to scroll to once the site is back (a link to it on a legal page).
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const go = (path: string) => {
      history.pushState(null, "", path);
      const page = legalPage();
      setLegal(page);
      window.scrollTo(0, 0);
    };
    // Links within the site move without a reload and without "#…" in the
    // address: to a section (scrolled to), to a legal page, back home.
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = (e.target as Element | null)?.closest?.("a")?.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) {
        e.preventDefault();
        const id = href.slice(1);
        if (legalPage()) {
          pending.current = id;
          go("/");
        } else scrollToSection(id);
      } else if (href === "/" || Object.values(LEGAL_PATHS).includes(href)) {
        e.preventDefault();
        if (href !== location.pathname) go(href);
      }
    };
    const back = () => setLegal(legalPage());
    document.addEventListener("click", click);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("click", click);
      window.removeEventListener("popstate", back);
    };
  }, []);
  useEffect(() => {
    if (legal || !pending.current) return;
    const id = pending.current;
    pending.current = null;
    requestAnimationFrame(() => scrollToSection(id));
  }, [legal]);
  if (legal) {
    return (
      <>
        <div className="site-backdrop" aria-hidden />
        <Legal page={legal} />
        <Footer />
      </>
    );
  }
  return <Site />;
}

function Site() {
  useReveal();
  return (
    <>
      <div className="site-backdrop" aria-hidden />
      <Header />
      <main className="relative z-10">
        <Hero />
        <Tour />
        {/* The in-game preview (sections/GamePreview) waits for real in-game shots. */}
        <Features />
        <Safety />
        <HowItWorks />
        <Faq />
        <Download />
      </main>
      <Footer />
    </>
  );
}
