import type { ReactNode } from "react";
import { useStrings } from "../i18n";
import { IconBolt, IconChart, IconChat, IconCheck, IconCrosshair, IconOverlay, IconSwap, IconUsers } from "../components/icons";

/** What else Radar does — the parts the tour's pictures don't show (their
 *  texts: features.items, in the same order). */
const FEATURE_ICONS: ReactNode[] = [
  <IconCrosshair />,
  <IconUsers />,
  <IconChart />,
  <IconSwap />,
  <IconChat />,
  <IconOverlay />,
  <IconCheck />,
  <IconBolt />,
];

export function Features() {
  const s = useStrings().features;
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-24">
      <SectionTitle kicker={s.kicker} title={s.title} text={s.text} />
      <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {s.items.map((f, i) => (
          <article key={f.title} className="reveal glass p-5" style={{ ["--r" as string]: "16px", ["--delay" as string]: `${(i % 4) * 0.06}s` }}>
            <div className="grid size-10 place-items-center rounded-xl bg-(--accent-soft) text-(--accent-text)">{FEATURE_ICONS[i]}</div>
            <h3 className="mt-4 font-display text-[16px] font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">{f.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Why it's safe to run next to the game. */
export function Safety() {
  const s = useStrings().safety;
  return (
    <section id="safety" className="relative mx-auto max-w-6xl px-5 py-24">
      <div className="reveal glass grid gap-10 p-8 sm:p-12 md:grid-cols-[1fr_1.1fr]" style={{ ["--r" as string]: "24px" }}>
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-(--accent-text) uppercase">{s.kicker}</p>
          <h2 className="headline mt-3 font-display text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">{s.title}</h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/55">
            {s.text}
          </p>
        </div>
        <ul className="flex flex-col gap-3 self-center">
          {s.items.map((t) => (
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
