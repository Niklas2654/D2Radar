import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { useCover } from "../lib/cover";
import { LOCALES, useLanguage, useT, type TranslationKey } from "../lib/i18n";
import { call, isTauri } from "../lib/tauri";
import { Badge, cx, GlassButton, GlassPanel, IconButton } from "./glass";
import { IconFeedback, IconChat, IconExternal } from "./icons";

type Kind = "bug" | "feature";

/** A reported bug or wished feature, from D2Radar's public issues (report_list). */
interface Entry {
  number: number;
  kind: Kind;
  title: string;
  body: string;
  state: "open" | "done" | "closed";
  created: string;
  comments: number;
  url: string;
}

/** Errors from report_send, as the page says them. */
const ERRORS: Record<string, TranslationKey> = {
  too_many: "feedback.tooMany",
  too_short: "feedback.tooShort",
  network: "feedback.network",
};

const TEXT: Record<Kind, { tab: TranslationKey; placeholder: TranslationKey; thanks: TranslationKey; list: TranslationKey; empty: TranslationKey; done: TranslationKey }> = {
  bug: {
    tab: "feedback.bug",
    placeholder: "feedback.placeholderBug",
    thanks: "feedback.thanksBug",
    list: "feedback.listBug",
    empty: "feedback.emptyBug",
    done: "feedback.fixed",
  },
  feature: {
    tab: "feedback.feature",
    placeholder: "feedback.placeholderFeature",
    thanks: "feedback.thanksFeature",
    list: "feedback.listFeature",
    empty: "feedback.emptyFeature",
    done: "feedback.built",
  },
};

/** The feedback button in the top bar and its window: a bug report or a feature
 *  wish goes, through the website, to a public issue on GitHub (no account
 *  needed, only the text and the app and Windows version), and the ones
 *  reported so far are listed below with their state. A draft stays when
 *  the window is closed, until it's sent. */
export function FeedbackButton() {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  useCover(open);
  const [kind, setKind] = useState<Kind>("bug");
  const [drafts, setDrafts] = useState<Record<Kind, string>>({ bug: "", feature: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ kind: Kind; url: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<Entry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const text = drafts[kind];
  const ready = !sending && text.trim().length >= 5;

  const load = useCallback((fresh: boolean) => {
    setLoading(true);
    setListError(null);
    call<Entry[]>("report_list", { fresh })
      .then((entries) => setList(entries ?? []))
      .catch((e) => setListError(String(e) === "rate_limited" ? "feedback.rateLimited" : "feedback.listFailed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) load(false);
  }, [open, load]);

  const close = () => {
    if (sending) return;
    setOpen(false);
    setError(null);
    setSent(null);
  };

  const pick = (next: Kind) => {
    setKind(next);
    setError(null);
    setSent(null);
    setExpanded(null);
  };

  const send = () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    setSent(null);
    call<string | null>("report_send", { kind, text })
      .then((url) => {
        setSent({ kind, url: url ?? null });
        setDrafts((d) => ({ ...d, [kind]: "" }));
        load(false);
      })
      .catch((e) => {
        const code = String(e);
        setError(ERRORS[code] ? t(ERRORS[code]) : t("feedback.failed", { code }));
      })
      .finally(() => setSending(false));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && e.ctrlKey) send();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!isTauri) return null;
  const shown = list?.filter((e) => e.kind === kind) ?? [];
  const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString(LOCALES[language], { dateStyle: "medium" }) : "");

  return (
    <>
      <IconButton label={t("feedback.title")} onClick={() => setOpen(true)}>
        <IconFeedback />
      </IconButton>
      {open && (
        // (Not closed by a click beside it: a draft would be lost to a slip.)
        <div className="animate-fade-in fixed inset-0 z-[90] grid place-items-center bg-[#020307]/60 p-6">
          <div className="h-[min(720px,86vh)] w-full max-w-[720px]">
            <GlassPanel className="flex h-full flex-col p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-[16px] font-semibold tracking-tight text-white">{t("feedback.title")}</h2>
                  <p className="mt-0.5 text-[12px] text-white/50">{t("feedback.subtitle")}</p>
                </div>
                <GlassButton size="sm" disabled={sending} onClick={close}>
                  {t("common.close")}
                </GlassButton>
              </div>

              <div className="mb-3 flex gap-2" role="tablist">
                {(["bug", "feature"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kind === k}
                    disabled={sending}
                    onClick={() => pick(k)}
                    className={cx(
                      "rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      kind === k
                        ? "border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)"
                        : "border-white/[0.07] bg-white/[0.03] text-white/70 hover:border-white/15",
                    )}
                  >
                    {t(TEXT[k].tab)}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  rows={5}
                  maxLength={5000}
                  value={text}
                  onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
                  placeholder={t(TEXT[kind].placeholder)}
                  aria-label={t(TEXT[kind].tab)}
                  className={cx(
                    "w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] leading-relaxed text-white outline-none",
                    "placeholder:text-white/30 focus:border-(--accent-glow)",
                  )}
                />
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[11.5px] leading-relaxed text-white/40">{t("feedback.public")}</p>
                  <GlassButton size="sm" variant="primary" disabled={!ready} onClick={send}>
                    {sending ? t("feedback.sending") : t("feedback.send")}
                  </GlassButton>
                </div>
                {error && (
                  <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>
                )}
                {sent && (
                  <p className="flex items-center gap-3 rounded-lg border border-(--accent-glow) bg-(--accent-soft) px-3 py-2 text-[12px] text-white/80">
                    <span>{t(TEXT[sent.kind].thanks)}</span>
                    {sent.url && (
                      <button
                        type="button"
                        onClick={() => void openUrl(sent.url!)}
                        className="text-(--accent-text) underline decoration-white/20 underline-offset-[3px] hover:decoration-current"
                      >
                        {t("feedback.view")}
                      </button>
                    )}
                  </p>
                )}
              </div>

              <div className="mt-5 mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold tracking-wider text-white/45 uppercase">
                  {t(TEXT[kind].list)}
                  {list && <span className="ml-1.5 text-white/30">{shown.length}</span>}
                </h3>
                {loading && <span className="text-[11px] text-white/35">{t("feedback.loading")}</span>}
              </div>

              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {listError ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <p className="text-[12.5px] text-white/50">{t(listError as TranslationKey)}</p>
                    <GlassButton size="sm" disabled={loading} onClick={() => load(true)}>
                      {t("feedback.retry")}
                    </GlassButton>
                  </div>
                ) : list && shown.length === 0 ? (
                  <p className="py-8 text-center text-[12.5px] text-white/40">{t(TEXT[kind].empty)}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {shown.map((entry) => {
                      const isOpen = expanded === entry.number;
                      return (
                        <li key={entry.number} className="rounded-xl border border-white/[0.07] bg-white/[0.03]">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setExpanded(isOpen ? null : entry.number)}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                          >
                            <Badge tone={entry.state === "open" ? "live" : "muted"} dot={false}>
                              {entry.state === "open"
                                ? t("feedback.open")
                                : entry.state === "done"
                                  ? t(TEXT[kind].done)
                                  : t("feedback.closed")}
                            </Badge>
                            <span
                              className={cx(
                                "min-w-0 flex-1 truncate text-[13px]",
                                entry.state === "closed" ? "text-white/45" : "text-white/85",
                              )}
                            >
                              {entry.title}
                            </span>
                            {entry.comments > 0 && (
                              <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-white/40 [&_svg]:size-3.5">
                                <IconChat />
                                {entry.comments}
                              </span>
                            )}
                            <span className="shrink-0 text-[11.5px] text-white/35 tabular-nums">{date(entry.created)}</span>
                          </button>
                          {isOpen && (
                            <div className="border-t border-white/[0.06] px-3 py-2.5">
                              {entry.body && (
                                <p className="text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-white/65">
                                  {entry.body}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => void openUrl(entry.url)}
                                className={cx(
                                  "flex items-center gap-1.5 text-[12px] text-(--accent-text) hover:underline [&_svg]:size-3.5",
                                  entry.body && "mt-2",
                                )}
                              >
                                {t("feedback.view")}
                                <IconExternal />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </>
  );
}
