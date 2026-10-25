import type { Strings } from "../i18n";

const it: Strings = {
  nav: { tour: "Tour", features: "Funzioni", safety: "Sicurezza", faq: "FAQ", download: "Scarica", language: "Lingua" },
  hero: {
    badge: "Gratis per Windows · v{version}",
    title: "Scopri ciò che il gioco",
    titleAccent: "non ti dice.",
    text: "Tutto sul tuo Guardiano, proprio accanto al gioco. Radar riconosce l'arma, l'armatura o il Guardiano che stai guardando e mostra ciò che il gioco non mostra: ogni roll, valori esatti, clear, lowman e build. In più dotazioni, DIM e Discord a portata di scorciatoia.",
    download: "Scarica per Windows",
    features: "Vedi tutte le funzioni",
    meta: "{size} · Windows 10/11 · Non affiliato a Bungie",
    inAction: "Guardalo in azione",
  },
  tour: {
    snippets: [
      {
        title: "Scanner della squadra",
        subtitle: "Clear, gradi e tempi migliori di tutti quelli con cui giochi",
        points: [
          "Full clear di incursioni e dungeon, contati dai report di Bungie",
          "La somma dei tuoi tempi migliori, per incursione e dungeon",
          "La tua squadra e i giocatori delle tue ultime attività, a un clic",
        ],
      },
      {
        title: "Ogni lowman, etichettato",
        subtitle: "Solo, duo e trio senza errori — con la classe usata",
        points: [
          "Clear del primo giorno, in modalità competizione e della prima settimana segnati come tali",
          "Run senza errori, maestro e in solitaria, con le imprese attive",
          "I simboli di classe mostrano ogni classe con cui è stata ottenuta un'etichetta",
        ],
      },
      {
        title: "Le run dietro un'etichetta",
        subtitle: "Un clic mostra la run — o una per classe",
        points: ["Uccisioni, morti e tempo di ogni giocatore", "Le armi più usate da ciascuno", "Un link al report completo su RaidHub"],
      },
      {
        title: "Ogni roll a colpo d'occhio",
        subtitle: "Tutte le peculiarità che un'arma può avere, e le tue copie",
        points: [
          "Ogni colonna di peculiarità, comprese quelle potenziate",
          "Le tue copie segnate nell'elenco",
          "Scegli due peculiarità e prendi la copia corrispondente dal deposito",
        ],
      },
      {
        title: "Cerca per provenienza",
        subtitle: "source:vaultofglass elenca tutto ciò che dà un raid, un dungeon o un pianeta",
        points: ["Armi e armature in un'unica ricerca", "Nomi, nomi dei set di armatura e provenienze, con completamento automatico", "Armature ordinate per classe e slot"],
      },
      {
        title: "Cosa usano i giocatori",
        subtitle: "Le armi e le peculiarità più usate degli ultimi 1.000 completamenti",
        points: ["Incursioni, dungeon o entrambi insieme", "Le peculiarità scelte su ogni arma, con la loro quota", "Aggiornato in background"],
      },
      {
        title: "Set di armatura con valori esatti",
        subtitle: "Bonus set con i valori reali, ogni tua copia",
        points: [
          "Bonus da due e quattro pezzi come funzionano davvero",
          "Tutte le tue copie con le loro statistiche, deposito incluso",
          "Doppio clic per prenderne una dal deposito",
        ],
      },
      {
        title: "Modifiche e calibrazione",
        subtitle: "Cambia le modifiche e vedi le statistiche prima di equipaggiare",
        points: [
          "Statistiche esatte di ogni modifica al passaggio del mouse",
          "Solo le modifiche che puoi davvero inserire, ordinate per costo",
          "Le tue statistiche con questo pezzo rispetto a ciò che indossi",
        ],
      },
      {
        title: "Tutte le tue dotazioni",
        subtitle: "Slot di gioco, dotazioni DIM e preset fianco a fianco",
        points: ["Equipaggia una dotazione con una scorciatoia, in gioco", "Salva una dotazione di gioco in DIM con un nome", "Preset che cambiano più dotazioni insieme"],
      },
      {
        title: "La build di qualsiasi Guardiano",
        subtitle: "Sottoclasse, armi, armatura e statistiche di chiunque cerchi",
        points: [
          "Ogni personaggio di un giocatore",
          "Armi con le loro peculiarità, armatura con modifiche e bonus set",
          "Cerca qualcuno per nome, o direttamente dalla sua schermata personaggio in gioco",
        ],
      },
    ],
    tryIt: "Clicca sull'app per provarla tu stesso.",
    tryItHint: "Una demo con dati di esempio (in inglese) – alcune funzioni vanno solo nell'app vera. Scorri su di essa o usa le frecce per vedere di più.",
    swipe: "Scorri, trascina o usa le frecce · clip dall'app vera",
    pictures: "Immagini dell'app",
    previous: "Precedente",
    next: "Successivo",
    demo: "Demo di Radar",
    clickToTry: "Clicca per provarla",
    backToTour: "Torna al tour",
  },
  features: {
    kicker: "Funzioni",
    title: "Un'app invece di cinque schede.",
    text: "Fatta per Destiny 2 su PC, pensata per non intralciarti.",
    items: [
      {
        title: "Riconosce ciò che guardi",
        text: "Ispeziona un'arma o un pezzo d'armatura e un avviso compare sopra il gioco. F10 apre la sua pagina completa.",
      },
      {
        title: "Legge i nomi dei Guardiani",
        text: "Apri la schermata personaggio di qualcuno e Radar lo trova — anche con trattini bassi, parentesi, simboli, nomi cirillici e CJK.",
      },
      {
        title: "Peculiarità dell'artefatto, esatte",
        text: "Nella schermata dell'artefatto Radar elenca ogni peculiarità dell'artefatto stagionale con ciò che fa davvero.",
      },
      {
        title: "Dotazioni con una scorciatoia",
        text: "Equipaggia dotazioni di gioco e di DIM senza uscire dalla partita, o cambia un intero preset in un colpo.",
      },
      {
        title: "DIM e Discord sopra il gioco",
        text: "F6 apre il tuo Discord LFG, F7 apre DIM, direttamente sopra Destiny. I codici /join hanno un pulsante che li copia.",
      },
      {
        title: "Un overlay che posizioni tu",
        text: "Orologio, statistiche della sessione e avvisi vanno dove vuoi. I clic passano direttamente al gioco.",
      },
      {
        title: "Si avvia con Destiny",
        text: "Radar aspetta nell'area di notifica e compare insieme al gioco. Tutto è caricato prima che tu arrivi in orbita.",
      },
      {
        title: "Non rallenta il gioco",
        text: "Radar usa pochissimo il tuo PC: l'overlay disegna solo dove sono i suoi widget, e tutto ciò che non usi va in pausa.",
      },
    ],
  },
  safety: {
    kicker: "Sicurezza",
    title: "Giù le mani dal gioco.",
    text: "Radar sta accanto a Destiny 2, non dentro. Guarda lo schermo e chiede a Bungie — nient'altro.",
    items: [
      "Non invia mai un tasto o un clic a Destiny 2",
      "Non legge né modifica la memoria o i file del gioco",
      "Legge solo ciò che è sullo schermo, come uno screenshot",
      "I tuoi dati vengono dall'API ufficiale di Bungie, come con DIM",
      "Il tuo accesso Bungie resta sul tuo PC",
    ],
  },
  how: {
    kicker: "Come funziona",
    title: "Pronto in pochi minuti.",
    steps: [
      { title: "Scarica", text: "Prendi l'installer ({size}). Non servono diritti di amministratore." },
      { title: "Collega Bungie", text: "Accedi una volta con il tuo account Bungie – niente chiavi, niente da configurare." },
      {
        title: "Avvia Destiny 2",
        text: "Radar compare con il gioco in modalità senza bordi. F10 apre ciò che guardi, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Domande e risposte.",
    items: [
      {
        q: "Posso essere bannato per usare Radar?",
        a: "Radar non inietta nulla, non legge la memoria del gioco e non invia mai input a Destiny 2. Legge ciò che è sullo schermo (come uno screenshot) e parla con l'API ufficiale di Bungie — proprio come DIM e le altre app companion.",
      },
      { q: "È gratis?", a: "Sì. Radar è gratuito da scaricare e usare." },
      {
        q: "A cosa serve l'accesso Bungie?",
        a: "Accedi sulla pagina di Bungie – Radar non vede mai la tua password. Permette a Radar di leggere deposito e inventario e di spostare o equipaggiare il tuo equipaggiamento. L'accesso resta sul tuo PC.",
      },
      {
        q: "L'overlay costa FPS?",
        a: "Un po', come qualsiasi finestra sopra un gioco. Radar lo tiene il più leggero possibile: l'overlay copre solo la parte di schermo dove sono i suoi widget, legge lo schermo solo quando qualcosa è cambiato, e mette in pausa DIM e Discord quando sono nascosti. Puoi disattivare l'overlay e tenere tutto il resto.",
      },
      {
        q: "Funziona con qualsiasi nome di Guardiano?",
        a: "Radar legge i nomi con un proprio riconoscimento integrato — nessun pacchetto lingua da installare. Simboli, nomi cirillici e CJK compresi. Se un nome è troppo elaborato, puoi sempre cercare il giocatore a mano.",
      },
      {
        q: "Quali lingue parla Radar?",
        a: "Italiano, inglese, tedesco, francese, spagnolo, portoghese (Brasile), polacco e russo – cambiala quando vuoi nelle impostazioni. Oggetti e attività arrivano da Bungie nella stessa lingua.",
      },
      { q: "Quali piattaforme?", a: "Windows 10 e 11, con Destiny 2 su Steam o sull'Epic Games Store in modalità finestra senza bordi." },
      {
        q: "Radar è fatto da Bungie?",
        a: "No. Radar è un'app companion creata da fan, non affiliata né approvata da Bungie. Destiny è un marchio di Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Pronto quando lo sei tu,",
    titleAccent: "Guardiano.",
    text: "Scarica Radar, avvia Destiny 2 e tutto è lì quando arrivi in orbita.",
    button: "Scarica per Windows",
    version: "Versione {version}",
    installer: "Installer da {size}",
    windows: "Windows 10 / 11",
    free: "Gratis",
    downloads: "{n} download",
    downloadsLive: "Conteggio in tempo reale",
    guardians: "{n} Guardiani connessi",
  },
  footer: {
    legal: "Note legali",
    privacy: "Privacy",
    disclaimer: "Non affiliato a Bungie. Destiny 2 è un marchio di Bungie, Inc.",
  },
};

export default it;
