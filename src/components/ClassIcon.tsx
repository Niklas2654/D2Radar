import { BUNGIE_ORIGIN } from "../lib/bungie";
import { cx } from "./glass";

export type ClassKind = "titan" | "hunter" | "warlock";

/** Bungie's own class symbols (the collections' class nodes in the
 *  manifest): white on clear, so used as a mask, in the text's colour. */
const ICONS: Record<ClassKind, string> = {
  titan: "/common/destiny2_content/icons/46a19ddd00d0f6ca822230943103b54a.png",
  hunter: "/common/destiny2_content/icons/05e32a388d9a65a0ef59b2193eee2db4.png",
  warlock: "/common/destiny2_content/icons/e4006d9a8fe167bd7e83193d7601c89a.png",
};

/** A class's official symbol, in the colour of the text around it. */
export function ClassIcon({ kind, title, className }: { kind: ClassKind; title: string; className?: string }) {
  const url = `url(${BUNGIE_ORIGIN}${ICONS[kind]})`;
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cx("inline-block shrink-0 bg-current", className ?? "size-3")}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }}
    />
  );
}
