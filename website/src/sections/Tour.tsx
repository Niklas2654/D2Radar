import { useEffect, useRef, useState } from "react";
import { LiveDemo } from "../components/LiveDemo";
import { RECORDED_ACCENT, recolor } from "../components/recolor";
import { ACCENT_EVENT, savedAccent, type SiteAccent } from "../fx";
import { Arrow, PrismCarousel, type CarouselControl, type FrontCard } from "../components/PrismCarousel";

/** One snippet of the app: a short clip of it (public/clips, recorded in
 *  the real app, 16:10) with a still from it, the caption under it, and
 *  what to know about it. */
interface Snippet {
  src: string;
  video: string;
  title: string;
  subtitle: string;
  points: string[];
}

const SNIPPETS: Snippet[] = [
  {
    src: "clips/fireteam.webp",
    video: "clips/fireteam.mp4",
    title: "Fireteam scanner",
    subtitle: "Clears, ranks and best times of everyone you play with",
    points: [
      "Raid and dungeon full clears, counted from Bungie's own reports",
      "The sum of your best times, per raid and dungeon",
      "Your fireteam and the players of your last activities, one click away",
    ],
  },
  {
    src: "clips/lowman.webp",
    video: "clips/lowman.mp4",
    title: "Every lowman, tagged",
    subtitle: "Solo, duo and trio flawless — with the class they were done on",
    points: [
      "Day one, contest and week one clears marked as such",
      "Flawless, master and solo runs, with the feats that were on",
      "The class symbols show every class a tag was earned on",
    ],
  },
  {
    src: "clips/runs.webp",
    video: "clips/runs.mp4",
    title: "The runs behind a tag",
    subtitle: "One click shows the run — or one per class",
    points: ["Kills, deaths and time for every player", "The weapons each of them used most", "A link to the full report on RaidHub"],
  },
  {
    src: "clips/weapon.webp",
    video: "clips/weapon.mp4",
    title: "Every roll at a glance",
    subtitle: "All perks a weapon can roll, and the copies you own",
    points: [
      "Every column of perks, enhanced ones included",
      "Your copies marked in the list",
      "Pick two perks and pull the matching copy from your vault",
    ],
  },
  {
    src: "clips/source.webp",
    video: "clips/source.mp4",
    title: "Search by where it drops",
    subtitle: "source:vaultofglass lists everything a raid, dungeon or planet drops",
    points: ["Weapons and armor in one search", "Names, armor set names and sources, with autocomplete", "Armor sorted by class and slot"],
  },
  {
    src: "clips/meta.webp",
    video: "clips/meta.mp4",
    title: "What the playerbase uses",
    subtitle: "The most used weapons and perks of the latest 1,000 completions",
    points: ["Raids, dungeons, or both together", "The perks people pick on each weapon, with their share", "Kept up to date in the background"],
  },
  {
    src: "clips/armor.webp",
    video: "clips/armor.mp4",
    title: "Armor sets with exact numbers",
    subtitle: "Set bonuses with the real values, every copy you own",
    points: [
      "Two- and four-piece bonuses as they actually work",
      "All your copies with their stats, vault included",
      "Double click one to pull it from the vault",
    ],
  },
  {
    src: "clips/armor2.webp",
    video: "clips/armor2.mp4",
    title: "Mods and tuning",
    subtitle: "Change mods and see your stats before you equip",
    points: [
      "Exact stats of every mod on hover",
      "Only the mods you can actually insert, sorted by cost",
      "Your stats with this piece against what you wear",
    ],
  },
  {
    src: "clips/loadouts.webp",
    video: "clips/loadouts.mp4",
    title: "All your loadouts",
    subtitle: "In-game slots, DIM loadouts and presets side by side",
    points: ["Equip a loadout with a hotkey, in game", "Save an in-game loadout to DIM with a name", "Presets that switch several loadouts at once"],
  },
  {
    src: "clips/build.webp",
    video: "clips/build.mp4",
    title: "Any Guardian's build",
    subtitle: "Subclass, weapons, armor and stats of anyone you look up",
    points: [
      "Every character of a player",
      "Weapons with their perks, armor with mods and set bonuses",
      "Look someone up by name, or straight from their character screen in game",
    ],
  },
];

/** The app's own accent colours: each has pictures (clips/<scene>-<id>.webp). */
const PRESET_ACCENTS = ["solar", "arc", "void", "stasis", "strand", "prismatic"];

/** The site's header (h-16), which stays over the cinema mode. */
const HEADER_HEIGHT = 64;

/** The demo's scene for each snippet (its clip's name). */
const SCENES = SNIPPETS.map((s) => s.video.replace(/^clips\/|\.mp4$/g, ""));

/** The tour: the app's clips in a coverflow (PrismCarousel), under the
 *  hero. It fades in once the page is scrolled a little (its clips start
 *  only then). */
export function Tour() {
  const [index, setIndex] = useState(0);
  const shown = SNIPPETS[index] ?? SNIPPETS[0];
  const box = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  // Wide screens with a mouse: the real app in front (LiveDemo), driven by
  // its autopilot until clicked; else the clips.
  const [live] = useState(() => matchMedia("(min-width: 900px) and (pointer: fine)").matches);
  // Text beside the cards (else under them).
  const [wide] = useState(() => matchMedia("(min-width: 900px)").matches);
  const front = useRef<FrontCard | null>(null);
  // With the live app: the pictures stay dark until it's up, then all come.
  const [demoUp, setDemoUp] = useState(false);
  // The site's colour (picked in the front app): the pictures beside it in
  // it too. The app's own colours have pictures of their own, taken from the
  // demo in each (scripts: website-stills); a colour of the visitor's own
  // recolours the Void ones. (Live apps beside the front one made the page
  // stutter: they share its one thread.)
  const [accent, setAccent] = useState<SiteAccent>(() => savedAccent() ?? { accent: "void", color: RECORDED_ACCENT });
  useEffect(() => {
    const on = (e: Event) => setAccent((e as CustomEvent<SiteAccent>).detail);
    window.addEventListener(ACCENT_EVENT, on);
    return () => window.removeEventListener(ACCENT_EVENT, on);
  }, []);
  const demoSrc = (a: string) => `app/index.html?demo&accent=${encodeURIComponent(a)}`;
  const still = (s: Snippet, id: string) => s.src.replace(/\.webp$/, `-${id}.webp`);
  const preset = PRESET_ACCENTS.includes(accent.accent);
  // (A picture missing: the recorded one stands in, `fallback`.)
  const [items, setItems] = useState(() => SNIPPETS.map((s) => ({ ...s, src: still(s, preset ? accent.accent : "void"), fallback: s.src })));
  useEffect(() => {
    if (preset) return setItems(SNIPPETS.map((s) => ({ ...s, src: still(s, accent.accent), fallback: s.src })));
    let alive = true;
    void Promise.all(SNIPPETS.map((s) => recolor(still(s, "void"), accent.color))).then((srcs) => {
      if (alive) setItems(SNIPPETS.map((s, i) => ({ ...s, src: srcs[i], fallback: s.src })));
    });
    return () => {
      alive = false;
    };
  }, [accent, preset]);
  // Every colour's pictures loaded (and decoded) ahead, once the app is up:
  // a colour picked in the app swaps them at once. Its own colour first.
  const preloaded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    if (!demoUp || !live) return;
    const order = [accent.accent, ...PRESET_ACCENTS.filter((a) => a !== accent.accent)].filter((a) => PRESET_ACCENTS.includes(a));
    const all = order.flatMap((id) => SNIPPETS.map((s) => still(s, id)));
    let i = 0;
    let timer = 0;
    const next = () => {
      for (const src of all.slice(i, i + 5)) {
        const img = new Image();
        img.src = src;
        void img.decode().catch(() => {});
        preloaded.current.push(img);
      }
      i += 5;
      if (i < all.length) timer = window.setTimeout(next, 250);
    };
    next();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoUp, live]);
  const control = useRef<CarouselControl | null>(null);
  const opener = useRef<(() => void) | null>(null);

  // Cinema mode: the nearer the carousel is to the middle of the window (of
  // the part under the header, which stays), the darker everything around it
  // (--cine, 0…1). Stopping on the way to it, the page glides on until it's
  // in the middle; going away from it, it lets go.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const root = document.documentElement;
    const offset = () => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 - (HEADER_HEIGHT + (innerHeight - HEADER_HEIGHT) / 2);
    };
    const reach = () => innerHeight * 0.55;
    let before = Math.abs(offset());
    let toward = false;
    let gliding = false;
    let timer = 0;
    const paint = () => {
      const p = Math.max(0, 1 - Math.abs(offset()) / reach());
      root.style.setProperty("--cine", p.toFixed(3));
      root.classList.toggle("cine", p > 0.6);
      return p;
    };
    const onScroll = () => {
      const dist = Math.abs(offset());
      toward = dist < before - 0.5;
      before = dist;
      paint();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (gliding) {
          gliding = false;
          return;
        }
        const off = offset();
        const p = paint();
        if (toward && p > 0.2 && Math.abs(off) > 4) {
          gliding = true;
          window.scrollBy({ top: off, behavior: "smooth" });
        }
      }, 140);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", paint);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", paint);
      window.clearTimeout(timer);
      root.style.removeProperty("--cine");
      root.classList.remove("cine");
    };
  }, []);
  useEffect(() => {
    const check = () => {
      const top = box.current?.getBoundingClientRect().top ?? Infinity;
      if (window.scrollY > 40 || top < window.innerHeight * 0.7) {
        setReady(true);
        window.removeEventListener("scroll", check);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  return (
    <section ref={box} id="tour" className="relative z-30 scroll-mt-10 pt-4 pb-20">
      {/* The dark around it in cinema mode. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[#030306]"
        style={{ opacity: "calc(var(--cine, 0) * 0.94)" }}
      />
      {/* What the front card shows on the left, the cards on the right (out
          to the window's edge, the next ones waiting there); on narrow
          screens the text under them. */}
      <div
        className={`flex flex-col gap-6 transition-[opacity,translate] duration-1000 ease-out min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-0 min-[900px]:pl-[max(40px,calc((100vw-1440px)/2))] ${ready ? "" : "translate-y-8 opacity-0"}`}
      >
        <div className="order-2 px-5 min-[900px]:order-1 min-[900px]:w-[290px] min-[900px]:shrink-0 min-[900px]:px-0 xl:w-[320px]">
          <div key={index} className="tour-swap">
            <div className="text-[12.5px] text-white/40 tabular-nums">
              {String(index + 1).padStart(2, "0")} / {String(SNIPPETS.length).padStart(2, "0")}
            </div>
            <h3 className="mt-2 font-display text-[26px] leading-tight font-semibold text-white">{shown.title}</h3>
            <p className="mt-2 text-[15px] leading-snug text-white/60">{shown.subtitle}</p>
            <ul className="mt-5 space-y-2.5">
              {shown.points.map((p) => (
                <li key={p} className="flex gap-2.5 text-[14px] leading-snug text-white/70">
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-(--accent)" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-7 flex items-center gap-3">
            <Arrow side="left" onClick={() => control.current?.prev()} />
            <Arrow side="right" onClick={() => control.current?.next()} />
          </div>
          {live ? (
            // The tip that the app beside is the real one, to be used.
            <p className="mt-6 flex items-start gap-2.5 text-[14px] leading-snug text-white/80">
              <svg viewBox="0 0 24 24" className="mt-px size-[18px] shrink-0 text-(--accent)" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 9l10.5 4-4.5 1.5L13.5 19 9 9z" />
                <path d="M5 5l2 2M12 3v2.5M3 12h2.5" />
              </svg>
              <span>
                Click the app to try it yourself.
                <span className="mt-1 block text-[12.5px] text-white/40">
                  A demo with sample data – some features only work in the real app. Scroll on it or use the arrows for more.
                </span>
              </span>
            </p>
          ) : (
            <p className="mt-5 text-[12px] leading-relaxed text-white/30">Swipe, drag or use the arrows · clips from the real app</p>
          )}
        </div>

        <div ref={stage} className="relative order-1 aspect-[1.85] w-full min-w-0 min-[900px]:order-2 min-[900px]:aspect-auto min-[900px]:h-[min(calc(100svh-120px),820px)] min-[900px]:flex-1">
          {ready && (
            <PrismCarousel
              items={items}
              onChange={setIndex}
              tilt={50}
              neighborScale={0.62}
              neighborAspect={16 / 10}
              size={0.94}
              // Moves on only when the visitor does (arrows, wheel, a swipe).
              autoplay={0}
              queue
              inset={wide ? 48 : 16}
              captions={false}
              live={live}
              veiled={live && !demoUp}
              front={front}
              control={control}
              onFrontClick={() => opener.current?.()}
            />
          )}
          {ready && live && <LiveDemo src={demoSrc(savedAccent()?.accent ?? "void")} scenes={SCENES} front={front} control={control} opener={opener} onReady={() => setDemoUp(true)} />}
        </div>
      </div>
    </section>
  );
}
