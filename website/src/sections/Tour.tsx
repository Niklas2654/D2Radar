import { useEffect, useRef, useState } from "react";
import { RECORDED_ACCENT, recolor } from "../components/recolor";
import { Stage } from "../components/Stage";
import { ACCENT_EVENT, savedAccent, type SiteAccent } from "../fx";
import { useStrings, type Strings } from "../i18n";
import { SectionTitle } from "./Features";

/** The tour's steps: each a scene of the demo's autopilot (the app's
 *  src/web/autopilot.ts), in the order of the site's texts (tour.snippets).
 *  A scene has a picture of its start (public/clips/<scene>-<colour>.webp)
 *  and, the older ones, a clip (<scene>.mp4). */
const SCENES = ["fireteam", "lowman", "runs", "weapon", "source", "meta", "armor", "armor2", "loadouts", "build", "builder", "optimize", "optimizeRules", "optimizeBuild"];
/** Scenes with a clip (for screens the live app isn't on). */
const CLIPS = new Set(["fireteam", "lowman", "runs", "weapon", "source", "meta", "armor", "armor2", "loadouts", "build"]);

/** The chapters, each with its steps (indices into SCENES and the texts);
 *  their names and texts: tour.chapters, in the same order. The last
 *  chapter, the game with Radar over it, is a section of its own
 *  (GamePreview). */
const ALL_CHAPTERS = [
  { id: "fireteam", steps: [0, 1, 2, 9] },
  { id: "database", steps: [3, 4, 5, 6, 7] },
  { id: "loadouts", steps: [8, 10] },
  { id: "optimizer", steps: [11, 12, 13] },
];
const CHAPTERS = ALL_CHAPTERS.map((c, index) => ({ ...c, index }));
/** The game chapter's place in tour.chapters, and its number on the page. */
export const GAME_CHAPTER = { index: ALL_CHAPTERS.length, number: CHAPTERS.length + 1 };

/** The app's own accent colours: each has pictures of its own. */
const PRESET_ACCENTS = ["solar", "arc", "void", "stasis", "strand", "prismatic"];

const two = (n: number) => String(n).padStart(2, "0");

/** The scenes' pictures in the site's colour (picked in the live app): the
 *  app's own colours have pictures of their own; a colour of the visitor's
 *  own recolours the Void ones. */
function useStills(): Record<string, string> {
  const [accent, setAccent] = useState<SiteAccent>(() => savedAccent() ?? { accent: "void", color: RECORDED_ACCENT });
  useEffect(() => {
    const on = (e: Event) => setAccent((e as CustomEvent<SiteAccent>).detail);
    window.addEventListener(ACCENT_EVENT, on);
    return () => window.removeEventListener(ACCENT_EVENT, on);
  }, []);
  const preset = PRESET_ACCENTS.includes(accent.accent);
  const of = (id: string) => Object.fromEntries(SCENES.map((s) => [s, `clips/${s}-${id}.webp`]));
  const [stills, setStills] = useState(() => of(preset ? accent.accent : "void"));
  useEffect(() => {
    if (preset) return setStills(of(accent.accent));
    let alive = true;
    void Promise.all(SCENES.map((s) => recolor(`clips/${s}-void.webp`, accent.color).catch(() => `clips/${s}.webp`))).then((srcs) => {
      if (alive) setStills(Object.fromEntries(SCENES.map((s, i) => [s, srcs[i]])));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, preset]);
  return stills;
}

/** The tour: the app's areas as chapters, each a few steps. On wide
 *  screens with a mouse the real app stays beside the texts and plays the
 *  step the page is scrolled to (Stage); elsewhere each step has its picture
 *  and clip. */
export function Tour() {
  const s = useStrings().tour;
  const [live] = useState(() => matchMedia("(min-width: 1024px) and (pointer: fine)").matches);
  const stills = useStills();
  return (
    <section id="tour" className="relative scroll-mt-16 pt-10 pb-6">
      <SectionTitle kicker={s.kicker} title={s.title} text={s.text} />
      {live ? <Scrolly s={s} stills={stills} /> : <Cards s={s} stills={stills} />}
    </section>
  );
}

type TourStrings = Strings["tour"];

/** Wide screens: the texts scroll past on the left, the app stays on the
 *  right and plays the step nearest the middle of the window. */
function Scrolly({ s, stills }: { s: TourStrings; stills: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const steps = useRef(new Map<number, HTMLElement>());
  const [active, setActive] = useState(CHAPTERS[0].steps[0]);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const middle = (64 + innerHeight) / 2;
      let best = -1;
      let dist = Infinity;
      for (const [i, el] of steps.current) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - middle);
        if (d < dist) {
          dist = d;
          best = i;
        }
      }
      if (best >= 0) setActive(best);
      const r = box.current?.getBoundingClientRect();
      if (r) {
        setPlaying(r.top < innerHeight * 0.7 && r.bottom > innerHeight * 0.3);
        if (r.top < innerHeight * 1.8) setNear(true);
      }
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);

  const scene = SCENES[active];
  const chapter = CHAPTERS.find((c) => c.steps.includes(active)) ?? CHAPTERS[0];
  const go = (step: number) => steps.current.get(step)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const pill = (on: boolean) =>
    `inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] transition-colors ${on ? "bg-(--accent-soft) text-(--accent-text)" : "bg-white/[0.05] text-white/55 hover:bg-white/[0.09] hover:text-white"}`;

  return (
    <div ref={box} className="mx-auto mt-4 grid max-w-[1720px] grid-cols-[minmax(280px,360px)_minmax(0,1fr)] gap-10 px-8 xl:gap-14">
      <div>
        {CHAPTERS.map((c, n) => (
          <div key={c.id} id={`tour-${c.id}`}>
            {c.steps.map((i, k) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) steps.current.set(i, el);
                  else steps.current.delete(i);
                }}
                className={`flex min-h-[78svh] flex-col justify-center py-10 transition-opacity duration-300 ${active === i ? "" : "opacity-30"}`}
              >
                {k === 0 && <ChapterHead number={n + 1} chapter={s.chapters[c.index]} />}
                <StepText snippet={s.snippets[i]} number={k + 1} of={c.steps.length} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div>
        <div className="tour-sticky sticky top-16 flex h-[calc(100svh-4rem)] flex-col justify-center">
          <div className="w-full" style={{ maxWidth: "calc((100svh - 14.5rem) * 1.6)" }}>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {CHAPTERS.map((c, n) => (
                <button key={c.id} onClick={() => go(c.steps[0])} className={pill(c === chapter)}>
                  <span className="text-[11.5px] tabular-nums opacity-60">{two(n + 1)}</span>
                  {s.chapters[c.index].name}
                </button>
              ))}
              <a href="#ingame" className={pill(false)}>
                <span className="text-[11.5px] tabular-nums opacity-60">{two(GAME_CHAPTER.number)}</span>
                {s.chapters[GAME_CHAPTER.index].name}
              </a>
            </div>
            <Stage
              labels={s}
              src={`app/index.html?demo&accent=${encodeURIComponent(savedAccent()?.accent ?? "void")}`}
              scene={scene}
              still={stills[scene]}
              fallback={`clips/${scene}.webp`}
              alt={s.snippets[active].title}
              playing={playing}
              load={near}
            />
            {/* The tip that the app here is the real one, to be used. */}
            <p className="mt-4 flex items-start gap-2.5 text-[13.5px] leading-snug text-white/75">
              <svg viewBox="0 0 24 24" className="mt-px size-[17px] shrink-0 text-(--accent)" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 9l10.5 4-4.5 1.5L13.5 19 9 9z" />
                <path d="M5 5l2 2M12 3v2.5M3 12h2.5" />
              </svg>
              <span>
                {s.tryIt} <span className="text-white/40">{s.tryItHint}</span>
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Narrow screens and touch: every step with its picture (its clip plays
 *  while it's on screen) and its text under it. */
function Cards({ s, stills }: { s: TourStrings; stills: Record<string, string> }) {
  return (
    <div className="mx-auto mt-12 max-w-2xl px-5">
      {CHAPTERS.map((c, n) => (
        <div key={c.id} id={`tour-${c.id}`} className={n ? "mt-20" : ""}>
          <ChapterHead number={n + 1} chapter={s.chapters[c.index]} />
          {c.steps.map((i, k) => {
            const scene = SCENES[i];
            return (
              <article key={i} className="reveal mt-10 first:mt-0">
                <Clip still={stills[scene]} fallback={`clips/${scene}.webp`} video={CLIPS.has(scene) ? `clips/${scene}.mp4` : null} alt={s.snippets[i].title} />

                <div className="mt-5">
                  <StepText snippet={s.snippets[i]} number={k + 1} of={c.steps.length} />
                </div>
              </article>
            );
          })}
        </div>
      ))}
      <p className="mt-10 text-center text-[12px] text-white/30">{s.swipe}</p>
    </div>
  );
}

/** A step's picture; its clip plays (silently, over and over) while it's
 *  on screen. */
function Clip({ still, fallback, video, alt }: { still: string; fallback: string; video: string | null; alt: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [poster, setPoster] = useState(still);
  useEffect(() => setPoster(still), [still]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [video]);
  const frame = "block aspect-[16/10] w-full rounded-[14px] border border-white/[0.07] bg-[#0b0c12] object-cover";
  return video ? (
    <video ref={ref} src={video} poster={poster} muted loop playsInline preload="none" aria-label={alt} className={frame} />
  ) : (
    <img src={poster} alt={alt} loading="lazy" className={frame} onError={() => poster !== fallback && setPoster(fallback)} />
  );
}

/** A chapter's heading: its number and name, what it's about. */
function ChapterHead({ number, chapter }: { number: number; chapter: { name: string; title: string; text: string } }) {
  return (
    <div className="mb-9">
      <p className="text-[12px] font-semibold tracking-[0.18em] text-(--accent-text) uppercase">
        {two(number)} · {chapter.name}
      </p>
      <h3 className="headline mt-3 font-display text-[28px] leading-[1.15] font-bold tracking-tight">{chapter.title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-white/55">{chapter.text}</p>
    </div>
  );
}

/** A step's text: its number in the chapter, title, subtitle and points. */
function StepText({ snippet, number, of }: { snippet: { title: string; subtitle: string; points: readonly string[] }; number: number; of: number }) {
  return (
    <div>
      <div className="text-[12.5px] text-white/40 tabular-nums">
        {two(number)} / {two(of)}
      </div>
      <h4 className="mt-2 font-display text-[22px] leading-tight font-semibold text-white">{snippet.title}</h4>
      <p className="mt-2 text-[15px] leading-snug text-white/60">{snippet.subtitle}</p>
      <ul className="mt-4 space-y-2.5">
        {snippet.points.map((p) => (
          <li key={p} className="flex gap-2.5 text-[14px] leading-snug text-white/70">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-(--accent)" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
