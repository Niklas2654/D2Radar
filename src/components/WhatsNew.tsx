import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useCover } from "../lib/cover";
import { useT } from "../lib/i18n";
import { isTauri } from "../lib/tauri";
import { loadWhatsNew, markSeen, type WhatsNew as Notes } from "../lib/whatsNew";
import { GlassButton, GlassPanel } from "./glass";

/** After an update, once: a small window with what the new version brought
 *  (its release notes). Closed, it doesn't come back.
 *  `ready`: the loading screen is gone. */
export function WhatsNew({ ready }: { ready: boolean }) {
  const t = useT();
  const [notes, setNotes] = useState<Notes | null>(null);
  useCover(!!notes);
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    void loadWhatsNew().then((found) => {
      if (!stale) setNotes(found);
    });
    return () => {
      stale = true;
    };
  }, [ready]);

  const close = () => {
    if (notes) markSeen(notes.version);
    setNotes(null);
  };
  useEffect(() => {
    if (!notes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!notes) return null;
  const { releases } = notes;
  const several = releases.length > 1;
  return (
    // (Not closed by a click beside it: the click that brings Radar to the
    // front after an update would close it before it's read.)
    <div className="animate-fade-in fixed inset-0 z-[90] grid place-items-center bg-[#020307]/60 p-6">
      <div className="w-full max-w-[440px]">
        <GlassPanel className="flex max-h-[min(560px,80vh)] flex-col p-5">
          <div className="mb-3">
            <h2 className="font-display text-[16px] font-semibold tracking-tight text-white">{t("whatsNew.title")}</h2>
            <div className="mt-0.5 text-[12px] font-semibold text-(--accent-text) tabular-nums">
              {/* Several versions since the last start: oldest – newest. */}
              Version {several ? `${releases[releases.length - 1].version} – ${releases[0].version}` : releases[0].version}
            </div>
          </div>
          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 text-[13px] leading-relaxed text-white/75">
            {several
              ? releases.map((r, i) => (
                  <section key={r.version} className={i ? "mt-4 border-t border-white/[0.06] pt-4" : ""}>
                    <div className="mb-2 font-display text-[13.5px] font-semibold text-white tabular-nums">
                      Version {r.version}
                    </div>
                    <Markdown text={r.notes} />
                  </section>
                ))
              : <Markdown text={releases[0].notes} />}
          </div>
          <div className="mt-4 flex justify-end">
            <GlassButton size="sm" autoFocus onClick={close}>
              {t("common.close")}
            </GlassButton>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

const open = (url: string) => (isTauri ? void openUrl(url) : window.open(url));

/** Release notes as written on GitHub, the little of Markdown they use:
 *  headings, lists, paragraphs; bold, code and links within. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="my-1.5 flex flex-col gap-1">
          {list}
        </ul>,
      );
      list = [];
    }
    if (paragraph.length) {
      blocks.push(
        <p key={blocks.length} className="my-1.5">
          {inline(paragraph.join(" "))}
        </p>,
      );
      paragraph = [];
    }
  };
  for (const raw of text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*+]\s+(.*)$/.exec(line);
    // Empty lines, rules and list items left empty.
    if (!line || /^([-*_])\1{2,}$/.test(line) || /^[-*+]$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      blocks.push(
        <h3
          key={blocks.length}
          className="mt-3.5 mb-1 text-[11px] font-semibold tracking-[0.08em] text-white/45 uppercase first:mt-0"
        >
          {inline(heading[2])}
        </h3>,
      );
    } else if (item) {
      if (paragraph.length) flush();
      list.push(
        <li key={list.length} className="flex gap-2">
          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-(--accent-text)" />
          <span className="min-w-0">{inline(item[1])}</span>
        </li>,
      );
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return <>{blocks}</>;
}

/** **bold**, `code`, [links](https://…) and bare addresses in a line. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) => {
    const link = /^\[([^\]]+)\]\((.+)\)$/.exec(part);
    const url = link ? link[2] : /^https?:\/\//.test(part) ? part : null;
    if (url) {
      return (
        <button key={i} className="cursor-pointer text-(--accent-text) hover:underline" onClick={() => open(url)}>
          {link ? link[1] : part.replace(/^https?:\/\//, "")}
        </button>
      );
    }
    if (part.startsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-white/[0.07] px-1 py-px text-[12px] text-white/85">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
