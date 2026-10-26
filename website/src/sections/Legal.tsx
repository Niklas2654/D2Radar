import { useState, type ReactNode } from "react";
import { Logo } from "../components/icons";

export type LegalPage = "impressum" | "datenschutz" | "signing";

/** A section on a pane of glass, like the site's panels. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass mt-5 p-6 sm:p-7" style={{ ["--r" as string]: "20px" }}>
      <h2 className="mb-3 font-display text-[19px] font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-[15px] font-semibold text-white/90">{children}</h3>;
}

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-(--accent-text) underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

type Lang = "en" | "de";
const LANG_KEY = "radar.site.legal-lang";

/** The one picked here before; else German if the site is in German, else
 *  English (the site's other languages have no legal text of their own). */
function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    // Storage blocked: from the site's language.
  }
  return document.documentElement.lang === "de" ? "de" : "en";
}

/** Legal notice (Impressum) and privacy policy, in English like the site,
 *  or in German (German law: that version is the binding one). */
export function Legal({ page }: { page: LegalPage }) {
  const [lang, setLang] = useState<Lang>(savedLang);
  const choose = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  return (
    <div className="relative z-10 min-h-screen">
      <header className="glass mx-auto mt-6 flex max-w-3xl items-center justify-between gap-3 px-5 py-3" style={{ ["--r" as string]: "18px" }}>
        <a href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="neon-title font-display text-[13px] font-semibold tracking-[0.42em]">RADAR</span>
        </a>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-white/[0.05] p-0.5 text-[12.5px] font-semibold">
            {(["en", "de"] as const).map((l) => (
              <button
                key={l}
                onClick={() => choose(l)}
                aria-pressed={lang === l}
                className={`rounded-[10px] px-2.5 py-1.5 transition-colors ${lang === l ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80"}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <a href="/" className="btn-ghost inline-flex h-9 items-center rounded-xl px-3.5 text-[13px] font-medium">
            {lang === "de" ? "← Zurück zur Seite" : "← Back to the site"}
          </a>
        </div>
      </header>
      <main lang={lang} className="mx-auto max-w-3xl px-5 pt-10 pb-24 text-[14.5px] leading-relaxed text-white/70">
        {page === "impressum" ? (
          lang === "de" ? <Impressum /> : <LegalNotice />
        ) : page === "signing" ? (
          lang === "de" ? <CodeSigningDe /> : <CodeSigning />
        ) : lang === "de" ? (
          <Datenschutz />
        ) : (
          <Privacy />
        )}
      </main>
    </div>
  );
}

/** Shown on the English pages: the German version is the binding one. */
function Binding() {
  return (
    <p className="mt-3 text-[13px] text-white/40">
      This is a translation for convenience; the German version (DE, top right) is the legally binding one.
    </p>
  );
}

function LegalNotice() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Legal notice</h1>
      <Binding />

      <Card title="Information pursuant to § 5 DDG (German Digital Services Act)">
        <p>
          Niklas Kipper
          <br />
          Siebsberg 21
          <br />
          38442 Wolfsburg
          <br />
          Germany
        </p>
      </Card>

      <Card title="Contact">
        <p>
          Email: D2Radar@outlook.de
        </p>
      </Card>

      <Card title="Responsible for the content pursuant to § 18 (2) MStV">
        <p>
          Niklas Kipper, address as above.
        </p>
      </Card>

      <Card title="About Bungie">
        <p>
          Radar is an independent fan project and not an official Bungie product. Radar is not affiliated with Bungie, Inc. and is neither endorsed
          nor reviewed by Bungie. Destiny and Destiny 2 are trademarks of Bungie, Inc.
        </p>
      </Card>

      <Card title="Data sources and thanks">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Perk descriptions with exact numbers: <A href="https://d2clarity.com">Clarity</A>
          </li>
          <li>Set bonuses, mods and other numbers: Destiny Data Compendium (community spreadsheet)</li>
          <li>
            Season of weapons: Destiny Item Manager (<A href="https://github.com/DestinyItemManager/DIM">DIM</A>, MIT license)
          </li>
          <li>Game data: Bungie.net API</li>
        </ul>
      </Card>

      <Card title="Liability for links">
        <p>
          This website and the app contain links to external third-party websites whose content I have no influence over. The respective provider
          or operator is always responsible for that content. Links found to infringe the law will be removed promptly.
        </p>
      </Card>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Privacy policy</h1>
      <p className="mt-3 text-[13px] text-white/40">Last updated: October 2026</p>
      <Binding />

      <Card title="1. Controller">
        <p>
          The controller for data processing on this website and in the app is Niklas Kipper, Siebsberg 21, 38442 Wolfsburg, Germany, email:{" "}
          D2Radar@outlook.de (see the{" "}
          <a href="/impressum" className="text-(--accent-text) hover:underline">
            legal notice
          </a>
          ).
        </p>
      </Card>

      <Card title="2. This website">
        <H3>Hosting and server logs</H3>
        <p>
          The website is hosted by Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA. When you open the site, Vercel automatically
          processes technically necessary data your browser sends: IP address, date and time of access, the page or file requested, referrer URL,
          browser type and operating system. This data is needed to deliver the website and keep it secure (legal basis: Art. 6(1)(f) GDPR) and is
          kept only as long as Vercel needs it for that. Data may be transferred to the USA; Vercel is certified under the EU-US Data Privacy
          Framework, and the EU Commission's standard contractual clauses apply as well.{" "}
          <A href="https://vercel.com/legal/privacy-policy">Vercel's privacy policy</A>
        </p>

        <H3>No cookies</H3>
        <p>
          This website sets no cookies. The accent colour you pick in the demo is kept in your browser's local storage (localStorage) so the site
          comes up in the same colour next time. It never leaves your computer and can be deleted at any time in your browser settings (§ 25 (2)
          no. 2 TDDDG).
        </p>

        <H3>Visitor statistics (Vercel Web Analytics)</H3>
        <p>
          To see how many people visit the site and which pages they look at, it uses Vercel Web Analytics. It works without cookies and stores
          nothing on your device. For each page view Vercel records the page, the referring site, the browser, the operating system, the device
          type and the country (derived from the IP address). Visitors are told apart only by a value calculated from the request, which is
          discarded after 24 hours; the IP address itself is not stored. I only see summed-up figures and can't tell who visited. The legal basis
          is Art. 6(1)(f) GDPR (the interest is knowing how the site is used); you can object at any time, e.g. with a content blocker. Provider
          and data transfer as under “Hosting” above.{" "}
          <A href="https://vercel.com/docs/analytics/privacy-policy">Privacy in Vercel Web Analytics</A>
        </p>

        <H3>The app demo</H3>
        <p>
          The demo on this page runs in your browser with sample data; it doesn't log you in anywhere and sends nothing you enter to third parties.
          As in the app itself, pictures (emblems, weapon icons, activity art) are loaded straight from Bungie's servers (www.bungie.net and Bungie's
          image server images.contentstack.io). They receive your IP address and the technically necessary request data (legal basis: Art. 6(1)(f)
          GDPR; the interest is showing the app as it really is).{" "}
          <A href="https://www.bungie.net/7/en/Legal/PrivacyPolicy">Bungie's privacy policy</A>
        </p>

        <H3>Download via GitHub</H3>
        <p>
          The download button fetches the installer from GitHub (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA). GitHub
          receives your IP address and the technically necessary request data; GitHub also counts how often the file was downloaded, without any
          way to tell who downloaded it. Data may be transferred to the USA; GitHub is certified under the EU-US Data Privacy Framework.{" "}
          <A href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</A>
        </p>
      </Card>

      <Card title="3. The Radar app">
        <p>
          Radar is a desktop application that runs on your computer. It has no analytics, tracking or user account. Settings, caches (e.g. game
          and weapon data) and login data are stored only locally on your computer and are removed when you uninstall Radar or delete its app
          folder.
        </p>

        <H3>Bungie login</H3>
        <p>
          When you log in with Bungie, Radar passes the one-time login code from Bungie (and, about once an hour while you use it, the token that
          keeps you logged in) through a small function on this website (d2radar.vercel.app/api/token, hosted by Vercel, see above). It adds
          Radar's app credentials, which must not be in the app itself, sends the request on to Bungie and returns Bungie's answer to Radar. It
          stores and logs no tokens; Vercel processes the technically necessary request data as described under “Hosting”. Legal basis:
          Art. 6(1)(b) GDPR (the login you asked for).
        </p>
        <p>
          To know how many people use Radar, the function also counts: the number of logins, and how many different Bungie accounts use Radar
          (in total and per day). For the latter it turns the account number in Bungie's answer into a salted, one-way hash and adds it to a
          statistical estimate (HyperLogLog), which keeps neither account numbers nor hashes, only an approximate count. Nothing else is
          stored, and the counts can't be traced back to anyone. They are kept with Upstash, Inc. (database service, through Vercel; stored in
          the EU). The totals are shown on this website. Legal basis: Art. 6(1)(f) GDPR (our legitimate interest in knowing how much Radar is
          used, with no personal data kept). You can turn the counting off in Radar under Settings → Privacy → “Count me anonymously”; the
          function then counts nothing for you.
        </p>

        <H3>Screen recognition</H3>
        <p>
          To recognise the weapons and armor you inspect, Radar captures parts of the screen while Destiny 2 runs and reads them with the text
          recognition built into Windows. This happens only locally; pictures and recognised text never leave your computer. A local diagnostic log
          (detect.log) is limited to 1 MB.
        </p>

        <H3>Updates</H3>
        <p>
          At start, every hour and when you bring Radar back to the front, Radar asks GitHub whether a new version is out; you can also check
          yourself under Settings → About Radar. You can turn these checks off under Settings → Privacy → “Check for updates automatically”. An update you install is downloaded from GitHub. GitHub receives your IP address and the technically necessary request data
          (provider and data transfer as under “Download via GitHub” above).
        </p>

        <H3>Connections to third parties</H3>
        <p>
          For its features the app fetches data straight from your computer from the services below. Each provider receives your IP address and the
          technically necessary request data and is responsible for processing it.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <b className="text-white/85">Bungie</b> (www.bungie.net, stats.bungie.net, images.contentstack.io): public profiles, activities, game
            data and pictures. Optionally you log in through Bungie's official login (OAuth); Radar then gets access to your inventory and loadouts.
            Radar never sees your password; the access token is stored only locally.{" "}
            <A href="https://www.bungie.net/7/en/Legal/PrivacyPolicy">Bungie's privacy policy</A>
          </li>
          <li>
            <b className="text-white/85">Destiny Item Manager</b> (app.destinyitemmanager.com, api.destinyitemmanager.com): only when you open DIM in
            Radar or use DIM loadouts. The DIM site is shown as in a browser; you log in with DIM or Bungie.
          </li>
          <li>
            <b className="text-white/85">Discord</b> (discord.com, cdn.discordapp.com): only when you open Discord in Radar. Discord is shown as in a
            browser and you log in with Discord directly. Radar reads the messages shown locally to add join buttons; it sends nothing in your name
            and stores no messages. <A href="https://discord.com/privacy">Discord's privacy policy</A>
          </li>
          <li>
            <b className="text-white/85">Google</b> (docs.google.com; Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland): Radar
            loads the public “Destiny Data Compendium” spreadsheet with set bonuses and mod numbers. Nothing about you is sent beyond the
            technically necessary request data. <A href="https://policies.google.com/privacy">Google's privacy policy</A>
          </li>
          <li>
            <b className="text-white/85">Clarity</b> (database-clarity.github.io, via GitHub Pages): perk descriptions; nothing about you is sent
            beyond the technically necessary request data.
          </li>
        </ul>
        <p className="mt-3">Links to other sites (e.g. RaidHub, Clarity) open in your browser; Radar itself doesn't contact them.</p>
        <p className="mt-3">
          The legal basis is Art. 6(1)(b) or (f) GDPR: these connections are needed to provide the features you use.
        </p>
      </Card>

      <Card title="4. Your rights">
        <p>
          You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data
          portability (Art. 20) and to object to processing based on Art. 6(1)(f) (Art. 21). Contact the email address above for any of these. You
          can also lodge a complaint with a data protection supervisory authority, for example the one where you live or{" "}
          the authority responsible for the controller: Die Landesbeauftragte für den Datenschutz Niedersachsen, Prinzenstraße 5, 30159 Hannover, Germany.
        </p>
      </Card>
    </>
  );
}

function Impressum() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Impressum</h1>

      <Card title="Angaben gemäß § 5 DDG">
        <p>
          Niklas Kipper
          <br />
          Siebsberg 21
          <br />
          38442 Wolfsburg
          <br />
          Deutschland
        </p>
      </Card>

      <Card title="Kontakt">
        <p>
          E-Mail: D2Radar@outlook.de
        </p>
      </Card>

      <Card title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          Niklas Kipper, Anschrift wie oben.
        </p>
      </Card>

      <Card title="Hinweis zu Bungie">
        <p>
          Radar ist ein unabhängiges Fan-Projekt und kein offizielles Produkt von Bungie. Radar steht in keiner Verbindung zu Bungie, Inc. und wird
          von Bungie weder unterstützt noch geprüft. Destiny und Destiny 2 sind Marken von Bungie, Inc.
        </p>
      </Card>

      <Card title="Datenquellen und Danksagungen">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Perk-Beschreibungen mit genauen Werten: <A href="https://d2clarity.com">Clarity</A>
          </li>
          <li>Set-Boni, Mods und weitere Werte: Destiny Data Compendium (Community-Tabelle)</li>
          <li>
            Saison-Zuordnung von Waffen: Destiny Item Manager (<A href="https://github.com/DestinyItemManager/DIM">DIM</A>, MIT-Lizenz)
          </li>
          <li>Spieldaten: Bungie.net API</li>
        </ul>
      </Card>

      <Card title="Haftung für Links">
        <p>
          Diese Website und die App enthalten Links zu externen Websites Dritter, auf deren Inhalte ich keinen Einfluss habe. Für diese fremden
          Inhalte ist stets der jeweilige Anbieter oder Betreiber verantwortlich. Bei Bekanntwerden von Rechtsverletzungen werden derartige Links
          umgehend entfernt.
        </p>
      </Card>

    </>
  );
}

function Datenschutz() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Datenschutzerklärung</h1>
      <p className="mt-3 text-[13px] text-white/40">Stand: Oktober 2026</p>

      <Card title="1. Verantwortlicher">
        <p>
          Verantwortlich für die Datenverarbeitung auf dieser Website und in der App ist Niklas Kipper, Siebsberg 21, 38442 Wolfsburg,
          E-Mail: D2Radar@outlook.de (siehe{" "}
          <a href="/impressum" className="text-(--accent-text) hover:underline">
            Impressum
          </a>
          ).
        </p>
      </Card>

      <Card title="2. Diese Website">
        <H3>Hosting und Server-Logfiles</H3>
        <p>
          Die Website wird bei Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA gehostet. Beim Aufruf der Seite verarbeitet Vercel
          automatisch technisch notwendige Daten, die Ihr Browser übermittelt: IP-Adresse, Datum und Uhrzeit des Zugriffs, aufgerufene Seite bzw.
          Datei, Referrer-URL, Browsertyp und Betriebssystem. Diese Daten sind nötig, um die Website auszuliefern und ihre Sicherheit zu
          gewährleisten (Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO), und werden nur so lange gespeichert, wie Vercel sie dafür benötigt. Dabei
          können Daten in die USA übermittelt werden; Vercel ist nach dem EU-US Data Privacy Framework zertifiziert, zusätzlich gelten die
          Standardvertragsklauseln der EU-Kommission. <A href="https://vercel.com/legal/privacy-policy">Datenschutz bei Vercel</A>
        </p>

        <H3>Keine Cookies</H3>
        <p>
          Diese Website setzt keine Cookies. Die Akzentfarbe, die Sie in der Demo wählen, wird im lokalen Speicher Ihres Browsers (localStorage)
          abgelegt, damit die Seite beim nächsten Besuch in derselben Farbe erscheint. Sie verlässt Ihren Rechner nicht und lässt sich über die
          Browser-Einstellungen jederzeit löschen (§ 25 Abs. 2 Nr. 2 TDDDG).
        </p>

        <H3>Besucherstatistik (Vercel Web Analytics)</H3>
        <p>
          Um zu sehen, wie viele Menschen die Seite besuchen und welche Seiten sie aufrufen, nutzt sie Vercel Web Analytics. Das funktioniert ohne
          Cookies und speichert nichts auf Ihrem Gerät. Je Seitenaufruf erfasst Vercel die aufgerufene Seite, die verweisende Seite, Browser,
          Betriebssystem, Gerätetyp und das Land (aus der IP-Adresse abgeleitet). Besucher werden nur über einen aus der Anfrage berechneten Wert
          unterschieden, der nach 24 Stunden verworfen wird; die IP-Adresse selbst wird nicht gespeichert. Ich sehe nur zusammengefasste Zahlen
          und kann nicht erkennen, wer die Seite besucht hat. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (das Interesse ist, die Nutzung der
          Seite zu kennen); Sie können jederzeit widersprechen, etwa mit einem Inhaltsblocker. Anbieter und Datenübermittlung wie oben unter
          „Hosting“.{" "}
          <A href="https://vercel.com/docs/analytics/privacy-policy">Datenschutz bei Vercel Web Analytics</A>
        </p>

        <H3>Die Demo der App</H3>
        <p>
          Die Demo auf dieser Seite läuft in Ihrem Browser mit Beispieldaten; sie meldet Sie nirgends an und sendet keine Eingaben an Dritte. Wie in
          der App selbst werden dabei Bilder (Embleme, Waffen-Icons, Aktivitäts-Bilder) direkt von den Servern von Bungie geladen (www.bungie.net
          und Bungies Bild-Server images.contentstack.io). Dabei erhalten diese Ihre IP-Adresse und die technisch nötigen Anfragedaten
          (Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO; das Interesse ist, die App wirklichkeitsgetreu zu zeigen).{" "}
          <A href="https://www.bungie.net/7/en/Legal/PrivacyPolicy">Datenschutz bei Bungie</A>
        </p>

        <H3>Download über GitHub</H3>
        <p>
          Der Download-Button lädt das Installationsprogramm von GitHub (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA).
          Dabei erhält GitHub Ihre IP-Adresse und die technisch nötigen Anfragedaten; GitHub zählt außerdem, wie oft die Datei heruntergeladen
          wurde, ohne dass daraus Rückschlüsse auf Personen möglich sind. Daten können in die USA übermittelt werden; GitHub ist nach dem EU-US
          Data Privacy Framework zertifiziert.{" "}
          <A href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement">Datenschutz bei GitHub</A>
        </p>
      </Card>

      <Card title="3. Die App „Radar“">
        <p>
          Radar ist eine Desktop-Anwendung, die auf Ihrem Rechner läuft. Sie enthält keine Analyse- oder Tracking-Funktionen und kein
          Benutzerkonto. Einstellungen, Zwischenspeicher (z. B. Spiel- und Waffendaten) und Anmeldedaten werden ausschließlich lokal auf Ihrem
          Rechner gespeichert und mit der Deinstallation bzw. dem Löschen des App-Ordners entfernt.
        </p>

        <H3>Bungie-Anmeldung</H3>
        <p>
          Wenn Sie sich mit Bungie anmelden, reicht Radar den einmaligen Anmeldecode von Bungie (und, während Sie Radar nutzen, etwa stündlich den
          Token, der Sie angemeldet hält) über eine kleine Funktion dieser Website weiter (d2radar.vercel.app/api/token, gehostet bei Vercel, siehe
          oben). Sie ergänzt die Zugangsdaten der Radar-App, die nicht in der App selbst stehen dürfen, schickt die Anfrage an Bungie und gibt
          Bungies Antwort an Radar zurück. Sie speichert und protokolliert keine Tokens; Vercel verarbeitet die technisch nötigen
          Anfragedaten wie unter „Hosting“ beschrieben. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (die von Ihnen gewünschte Anmeldung).
        </p>
        <p>
          Um zu wissen, wie viele Menschen Radar nutzen, zählt die Funktion außerdem: die Anzahl der Anmeldungen und wie viele verschiedene
          Bungie-Konten Radar nutzen (insgesamt und pro Tag). Dafür macht sie aus der Kontonummer in Bungies Antwort einen gesalzenen,
          nicht umkehrbaren Hash und fügt ihn einer statistischen Schätzung (HyperLogLog) hinzu, die weder Kontonummern noch Hashes
          aufbewahrt, sondern nur eine ungefähre Anzahl. Sonst wird nichts gespeichert, und die Zahlen lassen sich auf niemanden zurückführen.
          Sie liegen bei Upstash, Inc. (Datenbankdienst, über Vercel; gespeichert in der EU). Die Gesamtzahlen werden auf dieser Website
          angezeigt. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (unser berechtigtes Interesse zu wissen, wie viel Radar genutzt wird, ohne
          dass personenbezogene Daten aufbewahrt werden). Sie können das Zählen in Radar unter Einstellungen → Datenschutz → „Anonym
          mitzählen“ abschalten; die Funktion zählt Sie dann nicht mit.
        </p>

        <H3>Bildschirmerkennung</H3>
        <p>
          Um inspizierte Waffen und Rüstung zu erkennen, nimmt Radar während Destiny 2 läuft Bildschirmausschnitte auf und liest sie mit der in
          Windows eingebauten Texterkennung. Das geschieht ausschließlich lokal; Bilder und erkannte Texte verlassen Ihren Rechner nicht. Ein
          lokales Diagnoseprotokoll (detect.log) ist auf 1 MB begrenzt.
        </p>

        <H3>Updates</H3>
        <p>
          Beim Start, stündlich und wenn Sie Radar wieder in den Vordergrund holen, fragt Radar bei GitHub nach, ob eine neue Version erschienen
          ist; unter Einstellungen → Über Radar lässt sich das auch selbst anstoßen. Abschalten lässt sich diese Abfrage unter Einstellungen →
          Datenschutz → „Automatisch nach Updates suchen“. Wird ein Update installiert, wird es von GitHub heruntergeladen. Dabei erhält GitHub Ihre
          IP-Adresse und die technisch nötigen Anfragedaten (Anbieter und Datenübermittlung wie oben unter „Download über GitHub“).
        </p>

        <H3>Verbindungen zu Drittanbietern</H3>
        <p>
          Für ihre Funktionen ruft die App Daten direkt von Ihrem Rechner aus bei den folgenden Diensten ab. Dabei erhält der jeweilige Anbieter
          Ihre IP-Adresse und die technisch nötigen Anfragedaten; für deren Verarbeitung ist der jeweilige Anbieter verantwortlich.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <b className="text-white/85">Bungie</b> (www.bungie.net, stats.bungie.net, images.contentstack.io): öffentliche Profile, Aktivitäten,
            Spieldaten und Bilder. Optional
            melden Sie sich über Bungies offizielles Login (OAuth) an; Radar erhält dann Zugriff auf Ihr Inventar und Ihre Loadouts. Ihr Passwort
            sieht Radar nie; das Zugangs-Token wird lokal gespeichert. <A href="https://www.bungie.net/7/en/Legal/PrivacyPolicy">Datenschutz bei Bungie</A>
          </li>
          <li>
            <b className="text-white/85">Destiny Item Manager</b> (app.destinyitemmanager.com, api.destinyitemmanager.com): nur wenn Sie DIM in
            Radar öffnen bzw. DIM-Loadouts nutzen. Die DIM-Seite wird wie in einem Browser angezeigt; die Anmeldung erfolgt bei DIM bzw. Bungie.
          </li>
          <li>
            <b className="text-white/85">Discord</b> (discord.com, cdn.discordapp.com): nur wenn Sie Discord in Radar öffnen. Discord wird wie in einem Browser
            angezeigt, die Anmeldung erfolgt direkt bei Discord. Radar liest die angezeigten Nachrichten lokal, um Join-Buttons einzublenden; es
            sendet nichts in Ihrem Namen und speichert keine Nachrichten. <A href="https://discord.com/privacy">Datenschutz bei Discord</A>
          </li>
          <li>
            <b className="text-white/85">Google</b> (docs.google.com; Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland): Radar
            lädt die öffentliche Tabelle „Destiny Data Compendium“ mit Set-Boni und Mod-Werten. Es werden keine Daten über Sie übermittelt außer
            den technisch nötigen Anfragedaten. <A href="https://policies.google.com/privacy">Datenschutz bei Google</A>
          </li>
          <li>
            <b className="text-white/85">Clarity</b> (database-clarity.github.io, über GitHub Pages): Perk-Beschreibungen; es werden keine Daten
            über Sie übermittelt außer den technisch nötigen Anfragedaten.
          </li>
        </ul>
        <p className="mt-3">Links zu anderen Seiten (z. B. RaidHub, Clarity) öffnen sich in Ihrem Browser; Radar selbst ruft diese Seiten nicht ab.</p>
        <p className="mt-3">
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b bzw. f DSGVO: Die Verbindungen sind nötig, um die von Ihnen genutzten Funktionen bereitzustellen.
        </p>
      </Card>

      <Card title="4. Ihre Rechte">
        <p>
          Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
          Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f (Art. 21). Wenden Sie sich
          dazu an die oben genannte E-Mail-Adresse. Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa der Ihres
          Wohnorts oder der für den Verantwortlichen zuständigen Behörde: Die Landesbeauftragte für den Datenschutz Niedersachsen, Prinzenstraße 5, 30159 Hannover.
        </p>
      </Card>

    </>
  );
}

const REPO = "https://github.com/Niklas2654/D2Radar";

/** The code signing policy SignPath Foundation asks for: who signs what,
 *  how it is built, the team's roles, privacy. */
function CodeSigning() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Code signing policy</h1>
      <Card title="Signing">
        <p>
          Free code signing provided by <A href="https://signpath.io">SignPath.io</A>, certificate by{" "}
          <A href="https://signpath.org">SignPath Foundation</A>.
        </p>
        <p className="mt-3">
          Radar has applied for SignPath Foundation's free code signing for open source projects. Until it is approved, releases are not
          signed; once it is, the Windows installer of every release is.
        </p>
      </Card>
      <Card title="What is signed and how it is built">
        <p>
          Only Radar's own Windows installer, built from the source code in the public repository <A href={REPO}>{REPO.slice(8)}</A> (GPL-3.0)
          by GitHub Actions — never on a personal computer. Every signing request is approved by hand before it is signed.
        </p>
      </Card>
      <Card title="Team roles">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Committers and reviewers: Niklas Kipper (<A href="https://github.com/Niklas2654">@Niklas2654</A>)
          </li>
          <li>
            Approvers: Niklas Kipper (<A href="https://github.com/Niklas2654">@Niklas2654</A>)
          </li>
        </ul>
      </Card>
      <Card title="Privacy">
        <p>
          Radar connects to Bungie for your Destiny data and login, to its own login service (which also counts, anonymously, how many use
          Radar) and to GitHub to look for updates. The installer shows this before installing, and both the counting and the update checks can
          be turned off in Radar under Settings → Privacy. Details: <a href="/privacy" className="text-(--accent-text) underline-offset-2 hover:underline">privacy policy</a>.
        </p>
      </Card>
      <Card title="Uninstalling">
        <p>Windows Settings → Apps → Installed apps → Radar → Uninstall.</p>
      </Card>
    </>
  );
}

function CodeSigningDe() {
  return (
    <>
      <h1 className="headline font-display text-[36px] font-bold text-white">Code signing policy</h1>
      <Card title="Signierung">
        <p>
          Free code signing provided by <A href="https://signpath.io">SignPath.io</A>, certificate by{" "}
          <A href="https://signpath.org">SignPath Foundation</A>. (Kostenlose Codesignierung durch SignPath.io, Zertifikat der SignPath
          Foundation.)
        </p>
        <p className="mt-3">
          Radar hat sich für die kostenlose Codesignierung der SignPath Foundation für Open-Source-Projekte beworben. Bis zur Zusage sind die
          Versionen nicht signiert; danach wird der Windows-Installer jeder Version signiert.
        </p>
      </Card>
      <Card title="Was signiert wird und wie es gebaut wird">
        <p>
          Nur Radars eigener Windows-Installer, gebaut aus dem Quellcode im öffentlichen Repository <A href={REPO}>{REPO.slice(8)}</A> (GPL-3.0)
          von GitHub Actions – nie auf einem privaten Rechner. Jede Signieranfrage wird vor dem Signieren von Hand freigegeben.
        </p>
      </Card>
      <Card title="Rollen im Team">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Committer und Reviewer: Niklas Kipper (<A href="https://github.com/Niklas2654">@Niklas2654</A>)
          </li>
          <li>
            Freigabe (Approver): Niklas Kipper (<A href="https://github.com/Niklas2654">@Niklas2654</A>)
          </li>
        </ul>
      </Card>
      <Card title="Datenschutz">
        <p>
          Radar verbindet sich mit Bungie für Ihre Destiny-Daten und die Anmeldung, mit dem eigenen Login-Dienst (der außerdem anonym zählt, wie
          viele Radar nutzen) und mit GitHub, um nach Updates zu suchen. Der Installer zeigt das vor der Installation, und sowohl das Zählen als
          auch die Update-Suche lassen sich in Radar unter Einstellungen → Datenschutz abschalten. Einzelheiten:{" "}
          <a href="/privacy" className="text-(--accent-text) underline-offset-2 hover:underline">Datenschutzerklärung</a>.
        </p>
      </Card>
      <Card title="Deinstallieren">
        <p>Windows-Einstellungen → Apps → Installierte Apps → Radar → Deinstallieren.</p>
      </Card>
    </>
  );
}
