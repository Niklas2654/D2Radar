import { useSyncExternalStore } from "react";
import de from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import it from "./locales/it";
import pl from "./locales/pl";
import pt from "./locales/pt";
import ru from "./locales/ru";

/** Every text of the site in one language (the legal pages have their own:
 *  English and the binding German). The shape is the English one's. */
type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly Widen<U>[] : { readonly [K in keyof T]: Widen<T[K]> };
export type Strings = Widen<typeof en>;

export const SITE_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "it", label: "Italiano" },
  { id: "pt", label: "Português (Brasil)" },
  { id: "pl", label: "Polski" },
  { id: "ru", label: "Русский" },
] as const;

export type SiteLang = (typeof SITE_LANGUAGES)[number]["id"];

const STRINGS: Record<SiteLang, Strings> = { en, de, fr, es, it, pt, pl, ru };
const KEY = "radar.site.lang";
const isLang = (l: string | null): l is SiteLang => SITE_LANGUAGES.some((x) => x.id === l);

/** The one picked here before; else the browser's, if the site has it. */
function initial(): SiteLang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage blocked: the browser's language.
  }
  const browser = navigator.language.toLowerCase().slice(0, 2);
  return isLang(browser) ? browser : "en";
}

let current = initial();
const listeners = new Set<() => void>();
document.documentElement.lang = current;

export function setSiteLang(lang: SiteLang) {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  listeners.forEach((l) => l());
}

export function useSiteLang(): SiteLang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** The site's texts in the visitor's language. */
export function useStrings(): Strings {
  return STRINGS[useSiteLang()];
}

/** "{size}" and the like filled in. */
export function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
