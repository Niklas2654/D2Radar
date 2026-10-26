import type { Strings } from "../i18n";

const de: Strings = {
  nav: { tour: "Tour", features: "Funktionen", safety: "Sicherheit", faq: "FAQ", download: "Download", language: "Sprache" },
  hero: {
    badge: "Kostenlos für Windows · v{version}",
    title: "Sieh, was dir das Spiel",
    titleAccent: "nicht verrät.",
    text: "Alles über deinen Hüter, direkt neben dem Spiel. Radar erkennt die Waffe, Rüstung oder den Hüter, den du dir ansiehst, und zeigt, was das Spiel nicht zeigt: jeden Roll, exakte Zahlen, Clears, Lowmans und Builds. Dazu alle Loadouts an einem Ort und DIM und Discord nur einen Hotkey entfernt.",
    download: "Download für Windows",
    features: "Alle Funktionen ansehen",
    meta: "{size} · Windows 10/11 · Nicht mit Bungie verbunden",
    inAction: "So sieht es aus",
  },
  tour: {
    snippets: [
      {
        title: "Fireteam-Scanner",
        subtitle: "Clears, Ränge und Bestzeiten von allen, mit denen du spielst",
        points: [
          "Raid- und Dungeon-Full-Clears, gezählt aus Bungies eigenen Berichten",
          "Die Summe deiner Bestzeiten, pro Raid und Dungeon",
          "Dein Fireteam und die Spieler deiner letzten Aktivitäten, einen Klick entfernt",
        ],
      },
      {
        title: "Jeder Lowman, markiert",
        subtitle: "Solo, Duo und Trio Flawless – mit der Klasse, auf der sie geschafft wurden",
        points: [
          "Day-One-, Contest- und Week-One-Clears als solche markiert",
          "Flawless-, Meister- und Solo-Runs, mit den Feats, die an waren",
          "Die Klassensymbole zeigen jede Klasse, auf der ein Tag verdient wurde",
        ],
      },
      {
        title: "Die Runs hinter einem Tag",
        subtitle: "Ein Klick zeigt den Run – oder einen pro Klasse",
        points: ["Kills, Tode und Zeit für jeden Spieler", "Die Waffen, die jeder am meisten benutzt hat", "Ein Link zum vollen Bericht auf RaidHub"],
      },
      {
        title: "Jeder Roll auf einen Blick",
        subtitle: "Alle Perks, die eine Waffe rollen kann, und deine eigenen Exemplare",
        points: [
          "Jede Perk-Spalte, verbesserte Perks inklusive",
          "Deine Exemplare in der Liste markiert",
          "Zwei Perks wählen und das passende Exemplar aus dem Tresor holen",
        ],
      },
      {
        title: "Suche nach Herkunft",
        subtitle: "source:vaultofglass listet alles, was ein Raid, Dungeon oder Planet droppt",
        points: ["Waffen und Rüstung in einer Suche", "Namen, Rüstungsset-Namen und Quellen, mit Autovervollständigung", "Rüstung nach Klasse und Slot sortiert"],
      },
      {
        title: "Was die Spieler nutzen",
        subtitle: "Die meistgenutzten Waffen und Perks der letzten 1.000 Abschlüsse",
        points: ["Raids, Dungeons oder beides zusammen", "Die Perks, die Spieler auf jeder Waffe wählen, mit ihrem Anteil", "Im Hintergrund aktuell gehalten"],
      },
      {
        title: "Rüstungssets mit exakten Zahlen",
        subtitle: "Set-Boni mit den echten Werten, jedes deiner Exemplare",
        points: [
          "Zwei- und Vier-Teile-Boni, so wie sie wirklich funktionieren",
          "Alle deine Exemplare mit ihren Werten, Tresor inklusive",
          "Doppelklick holt eines aus dem Tresor",
        ],
      },
      {
        title: "Mods und Tuning",
        subtitle: "Mods ändern und deine Werte sehen, bevor du ausrüstest",
        points: [
          "Exakte Werte jeder Mod beim Drüberfahren",
          "Nur die Mods, die du wirklich einsetzen kannst, nach Kosten sortiert",
          "Deine Werte mit diesem Teil im Vergleich zu dem, was du trägst",
        ],
      },
      {
        title: "Alle deine Loadouts",
        subtitle: "Ingame-Slots, DIM-Loadouts und Presets nebeneinander",
        points: ["Jedes Loadout mit einem Klick ausrüsten", "Ein Ingame-Loadout mit Namen in DIM speichern", "Presets, die mehrere Loadouts auf einmal wechseln"],
      },
      {
        title: "Der Build jedes Hüters",
        subtitle: "Subklasse, Waffen, Rüstung und Werte von jedem, den du nachschlägst",
        points: [
          "Jeder Charakter eines Spielers",
          "Waffen mit ihren Perks, Rüstung mit Mods und Set-Boni",
          "Jemanden per Name suchen – oder direkt von seinem Charakterbildschirm im Spiel",
        ],
      },
    ],
    tryIt: "Klick die App an und probier sie selbst aus.",
    tryItHint: "Eine Demo mit Beispieldaten (auf Englisch) – manche Funktionen gehen nur in der echten App. Scrollen oder die Pfeile zeigen mehr.",
    swipe: "Wischen, ziehen oder die Pfeile nutzen · Clips aus der echten App",
    pictures: "Bilder der App",
    previous: "Zurück",
    next: "Weiter",
    demo: "Radar-Demo",
    clickToTry: "Klicken und selbst ausprobieren",
    backToTour: "Zurück zur Tour",
  },
  features: {
    kicker: "Funktionen",
    title: "Eine App statt fünf Tabs.",
    text: "Gebaut für Destiny 2 auf dem PC, gemacht, um nicht im Weg zu sein.",
    items: [
      {
        title: "Erkennt, was du dir ansiehst",
        text: "Sieh dir eine Waffe oder ein Rüstungsteil an, und ein Hinweis erscheint über dem Spiel. F10 öffnet die ganze Seite dazu.",
      },
      {
        title: "Liest Hüter-Namen",
        text: "Öffne den Charakterbildschirm von jemandem, und Radar findet ihn – auch mit Unterstrichen, Klammern, Symbolen, kyrillischen und CJK-Namen.",
      },
      {
        title: "Artefakt-Perks, exakt",
        text: "Auf dem Artefakt-Bildschirm listet Radar jeden Perk des Saison-Artefakts mit dem, was er wirklich tut.",
      },
      {
        title: "Alle Loadouts an einem Ort",
        text: "Ingame- und DIM-Loadouts mit einem Klick ausrüsten, neue in DIM speichern – oder ein ganzes Preset auf einmal wechseln.",
      },
      {
        title: "DIM und Discord über dem Spiel",
        text: "F6 öffnet deinen LFG-Discord, F7 öffnet DIM, direkt über Destiny. /join-Codes bekommen einen Button, der sie kopiert.",
      },
      {
        title: "Ein Overlay, das du selbst platzierst",
        text: "Uhr, Session-Werte und die Hinweise kommen dorthin, wo du sie haben willst. Klicks gehen direkt durch ins Spiel.",
      },
      {
        title: "Startet mit Destiny",
        text: "Radar wartet im Infobereich und kommt, wenn das Spiel startet. Alles ist geladen, bevor du im Orbit landest.",
      },
      {
        title: "Bremst dein Spiel nicht",
        text: "Radar braucht kaum etwas von deinem PC: Das Overlay zeichnet nur, wo seine Widgets sind, und alles, was du gerade nicht nutzt, pausiert.",
      },
    ],
  },
  safety: {
    kicker: "Sicherheit",
    title: "Finger weg vom Spiel.",
    text: "Radar sitzt neben Destiny 2, nicht darin. Es schaut auf den Bildschirm und fragt Bungie – sonst nichts.",
    items: [
      "Schickt nie einen Tastendruck oder Klick an Destiny 2",
      "Liest oder ändert weder Speicher noch Dateien des Spiels",
      "Liest nur, was auf deinem Bildschirm ist, wie ein Screenshot",
      "Deine Daten kommen von Bungies offizieller API, wie bei DIM",
      "Dein Bungie-Login bleibt auf deinem PC",
      "Open Source: der komplette Code ist öffentlich auf GitHub",
    ],
  },
  how: {
    kicker: "So geht's",
    title: "In wenigen Minuten startklar.",
    steps: [
      { title: "Herunterladen", text: "Hol dir den Installer ({size}). Keine Admin-Rechte nötig." },
      { title: "Bungie verbinden", text: "Einmal mit deinem Bungie-Konto anmelden – keine Keys, nichts einzurichten." },
      {
        title: "Destiny 2 starten",
        text: "Radar startet mit dem Spiel im randlosen Modus. F10 öffnet, was du ansiehst, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Fragen und Antworten.",
    items: [
      {
        q: "Kann ich für Radar gebannt werden?",
        a: "Radar injiziert nichts, liest nicht den Speicher des Spiels und schickt nie Eingaben an Destiny 2. Es liest, was auf deinem Bildschirm ist (wie ein Screenshot), und spricht mit Bungies offizieller API – genauso wie DIM und andere Companion-Apps.",
      },
      { q: "Ist es kostenlos?", a: "Ja. Radar ist kostenlos herunterzuladen und zu benutzen." },
      { q: "Ist Radar Open Source?", a: "Ja. Der komplette Quellcode von Radar ist öffentlich auf GitHub – github.com/Niklas2654/D2Radar – unter der Lizenz GPL-3.0. Der Code jeder veröffentlichten Version steht dort." },
      {
        q: "Wofür ist der Bungie-Login?",
        a: "Du meldest dich auf Bungies eigener Seite an – Radar sieht dein Passwort nie. Damit kann Radar deinen Tresor und dein Inventar lesen und deine Ausrüstung verschieben oder anlegen. Der Login bleibt auf deinem PC.",
      },
      {
        q: "Kostet das Overlay FPS?",
        a: "Ein wenig, wie jedes Fenster über einem Spiel. Radar hält es so klein wie möglich: Das Overlay deckt nur den Teil des Bildschirms ab, in dem seine Widgets sind, liest den Bildschirm nur, wenn sich etwas geändert hat, und schickt DIM und Discord schlafen, solange sie versteckt sind. Du kannst das Overlay ausschalten und alles andere behalten.",
      },
      {
        q: "Funktioniert es mit jedem Hüter-Namen?",
        a: "Radar liest Namen mit einer eigenen, eingebauten Erkennung – keine Sprachpakete nötig. Symbole, kyrillische und CJK-Namen inklusive. Ist ein Name zu ausgefallen, kannst du den Spieler immer noch von Hand suchen.",
      },
      {
        q: "Welche Sprachen spricht Radar?",
        a: "Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch (Brasilien), Polnisch und Russisch – jederzeit in den Einstellungen umstellbar. Items und Aktivitäten kommen von Bungie in derselben Sprache.",
      },
      { q: "Welche Plattformen?", a: "Windows 10 und 11, mit Destiny 2 auf Steam oder im Epic Games Store im randlosen Fenstermodus." },
      {
        q: "Ist Radar von Bungie?",
        a: "Nein. Radar ist eine Fan-App und weder mit Bungie verbunden noch von Bungie unterstützt. Destiny ist eine Marke von Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Bereit, wenn du es bist,",
    titleAccent: "Hüter.",
    text: "Radar herunterladen, Destiny 2 starten – und alles ist da, wenn du im Orbit landest.",
    button: "Download für Windows",
    version: "Version {version}",
    installer: "{size} Installer",
    windows: "Windows 10 / 11",
    free: "Kostenlos",
    openSource: "Open Source",
    downloads: "{n} Downloads",
    downloadsLive: "Live gezählt",
    active: "{n} aktive Guardians",
    activeLive: "Bungie-Konten, die Radar in den letzten 30 Tagen genutzt haben – live gezählt",
  },
  footer: {
    legal: "Impressum",
    privacy: "Datenschutz",
    source: "Quellcode",
    disclaimer: "Nicht mit Bungie verbunden. Destiny 2 ist eine Marke von Bungie, Inc.",
  },
};

export default de;
