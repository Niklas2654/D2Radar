import type { ReactNode } from "react";
import { IconBolt, IconChart, IconChat, IconCheck, IconCrosshair, IconOverlay, IconSwap, IconUsers } from "../components/icons";

/** What else Radar does — the parts the tour's pictures don't show. */
const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <IconCrosshair />,
    title: "Recognises what you look at",
    text: "Inspect a weapon or a piece of armor and a notice shows up over the game. F10 opens the full page for it.",
  },
  {
    icon: <IconUsers />,
    title: "Reads Guardian names",
    text: "Open someone's character screen and Radar finds them — underscores, brackets, symbols, Cyrillic and CJK names too.",
  },
  {
    icon: <IconChart />,
    title: "Artifact perks, exact",
    text: "On the artifact screen Radar lists every perk of the season's artifact with what it actually does.",
  },
  {
    icon: <IconSwap />,
    title: "Loadouts on a hotkey",
    text: "Equip in-game and DIM loadouts without leaving the game, or switch a whole preset at once.",
  },
  {
    icon: <IconChat />,
    title: "DIM and Discord over the game",
    text: "F6 opens your LFG Discord, F7 opens DIM, right over Destiny. /join codes get a button that copies them.",
  },
  {
    icon: <IconOverlay />,
    title: "An overlay you place yourself",
    text: "Clock, session stats and the notices go where you want them. Clicks pass straight through to the game.",
  },
  {
    icon: <IconCheck />,
    title: "Starts with Destiny",
    text: "Radar waits in the tray and comes up when the game does. Everything is loaded before you land in orbit.",
  },
  {
    icon: <IconBolt />,
    title: "Won't slow your game down",
    text: "Radar barely uses your PC: the overlay only draws where its widgets are, and anything you're not using pauses.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-24">
      <SectionTitle kicker="Features" title="One app instead of five tabs." text="Built for Destiny 2 on PC, made to stay out of your way." />
      <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <article key={f.title} className="reveal glass p-5" style={{ ["--r" as string]: "16px", ["--delay" as string]: `${(i % 4) * 0.06}s` }}>
            <div className="grid size-10 place-items-center rounded-xl bg-(--accent-soft) text-(--accent-text)">{f.icon}</div>
            <h3 className="mt-4 font-display text-[16px] font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">{f.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

const SAFE = [
  "Never sends a key press or a click to Destiny 2",
  "Doesn't read or change the game's memory or files",
  "Reads only what's on your screen, like a screenshot",
  "Your data comes from Bungie's official API, as with DIM",
  "Your Bungie login stays on your PC",
];

/** Why it's safe to run next to the game. */
export function Safety() {
  return (
    <section id="safety" className="relative mx-auto max-w-6xl px-5 py-24">
      <div className="reveal glass grid gap-10 p-8 sm:p-12 md:grid-cols-[1fr_1.1fr]" style={{ ["--r" as string]: "24px" }}>
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-(--accent-text) uppercase">Safety</p>
          <h2 className="headline mt-3 font-display text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">Hands off the game.</h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/55">
            Radar sits next to Destiny 2, not inside it. It looks at the screen and asks Bungie — nothing else.
          </p>
        </div>
        <ul className="flex flex-col gap-3 self-center">
          {SAFE.map((t) => (
            <li key={t} className="flex items-start gap-3 text-[15px] text-white/75">
              <span className="mt-0.5 shrink-0 text-(--accent-text) [&_svg]:size-4">
                <IconCheck />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function SectionTitle({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <div className="reveal mx-auto max-w-2xl text-center">
      <p className="text-[12px] font-semibold tracking-[0.18em] text-(--accent-text) uppercase">{kicker}</p>
      <h2 className="headline mt-3 font-display text-[34px] leading-tight font-bold tracking-tight sm:text-[46px]">{title}</h2>
      {text && <p className="mt-4 text-[16px] text-white/55">{text}</p>}
    </div>
  );
}
