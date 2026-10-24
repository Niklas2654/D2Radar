import type { Strings } from "../i18n";

const pl: Strings = {
  nav: { tour: "Prezentacja", features: "Funkcje", safety: "Bezpieczeństwo", faq: "FAQ", download: "Pobierz", language: "Język" },
  hero: {
    badge: "Za darmo na Windows · v{version}",
    title: "Zobacz to, czego gra",
    titleAccent: "ci nie powie.",
    text: "Wszystko o twoim Strażniku, tuż obok gry. Radar rozpoznaje broń, pancerz lub Strażnika, na którego patrzysz, i pokazuje to, czego gra nie pokazuje: każdy roll, dokładne wartości, ukończenia, lowmany i buildy. Do tego uzbrojenia, DIM i Discord pod jednym skrótem.",
    download: "Pobierz na Windows",
    features: "Zobacz wszystkie funkcje",
    meta: "{size} · Windows 10/11 · Niezwiązany z Bungie",
    inAction: "Zobacz w akcji",
  },
  tour: {
    snippets: [
      {
        title: "Skaner drużyny",
        subtitle: "Ukończenia, rangi i najlepsze czasy wszystkich, z którymi grasz",
        points: [
          "Pełne ukończenia rajdów i lochów, liczone z raportów samego Bungie",
          "Suma twoich najlepszych czasów, dla każdego rajdu i lochu",
          "Twoja drużyna i gracze z ostatnich aktywności, jedno kliknięcie dalej",
        ],
      },
      {
        title: "Każdy lowman, oznaczony",
        subtitle: "Solo, duo i trio bez skazy — z klasą, którą to zrobiono",
        points: [
          "Ukończenia z pierwszego dnia, w trybie rywalizacji i z pierwszego tygodnia oznaczone jako takie",
          "Runy bez skazy, mistrzowskie i solo, z włączonymi wyczynami",
          "Symbole klas pokazują każdą klasę, na której zdobyto oznaczenie",
        ],
      },
      {
        title: "Runy za oznaczeniem",
        subtitle: "Jedno kliknięcie pokazuje run — albo jeden na klasę",
        points: ["Zabójstwa, śmierci i czas każdego gracza", "Broń, której każdy używał najczęściej", "Link do pełnego raportu na RaidHub"],
      },
      {
        title: "Każdy roll w jednym widoku",
        subtitle: "Wszystkie cechy, jakie może mieć broń, i twoje egzemplarze",
        points: [
          "Każda kolumna cech, łącznie z ulepszonymi",
          "Twoje egzemplarze zaznaczone na liście",
          "Wybierz dwie cechy i wyjmij pasujący egzemplarz ze schowka",
        ],
      },
      {
        title: "Szukaj po źródle",
        subtitle: "source:vaultofglass pokazuje wszystko, co wypada z rajdu, lochu lub planety",
        points: ["Broń i pancerz w jednym wyszukiwaniu", "Nazwy, nazwy zestawów pancerza i źródła, z autouzupełnianiem", "Pancerz posortowany według klasy i slotu"],
      },
      {
        title: "Czego używają gracze",
        subtitle: "Najczęściej używana broń i cechy z ostatnich 1000 ukończeń",
        points: ["Rajdy, lochy albo oba naraz", "Cechy wybierane na każdej broni, z ich udziałem", "Aktualizowane w tle"],
      },
      {
        title: "Zestawy pancerza z dokładnymi wartościami",
        subtitle: "Premie zestawu z prawdziwymi wartościami, każdy twój egzemplarz",
        points: [
          "Premie za dwie i cztery części tak, jak naprawdę działają",
          "Wszystkie twoje egzemplarze z ich statystykami, łącznie ze schowkiem",
          "Podwójne kliknięcie wyjmuje egzemplarz ze schowka",
        ],
      },
      {
        title: "Modyfikacje i strojenie",
        subtitle: "Zmieniaj modyfikacje i sprawdzaj statystyki przed założeniem",
        points: [
          "Dokładne statystyki każdej modyfikacji po najechaniu",
          "Tylko modyfikacje, które naprawdę możesz wstawić, posortowane według kosztu",
          "Twoje statystyki z tą częścią w porównaniu z tym, co nosisz",
        ],
      },
      {
        title: "Wszystkie twoje uzbrojenia",
        subtitle: "Sloty w grze, uzbrojenia DIM i presety obok siebie",
        points: ["Załóż uzbrojenie skrótem, w grze", "Zapisz uzbrojenie z gry w DIM pod nazwą", "Presety, które zmieniają kilka uzbrojeń naraz"],
      },
      {
        title: "Build dowolnego Strażnika",
        subtitle: "Podklasa, broń, pancerz i statystyki każdego, kogo wyszukasz",
        points: [
          "Każda postać gracza",
          "Broń z cechami, pancerz z modyfikacjami i premiami zestawu",
          "Wyszukaj kogoś po nazwie albo prosto z jego ekranu postaci w grze",
        ],
      },
    ],
    tryIt: "Kliknij aplikację, aby wypróbować ją samodzielnie.",
    tryItHint: "Demo z przykładowymi danymi (po angielsku) – niektóre funkcje działają tylko w prawdziwej aplikacji. Przewijaj na niej lub użyj strzałek, aby zobaczyć więcej.",
    swipe: "Przesuń, przeciągnij lub użyj strzałek · nagrania z prawdziwej aplikacji",
    pictures: "Zdjęcia aplikacji",
    previous: "Poprzedni",
    next: "Następny",
    demo: "Demo Radaru",
    clickToTry: "Kliknij, aby wypróbować",
    backToTour: "Wróć do prezentacji",
  },
  features: {
    kicker: "Funkcje",
    title: "Jedna aplikacja zamiast pięciu kart.",
    text: "Stworzona dla Destiny 2 na PC, tak by nie wchodzić ci w drogę.",
    items: [
      {
        title: "Rozpoznaje to, na co patrzysz",
        text: "Obejrzyj broń lub część pancerza, a nad grą pojawi się powiadomienie. F10 otwiera jej pełną stronę.",
      },
      {
        title: "Czyta nazwy Strażników",
        text: "Otwórz czyjś ekran postaci, a Radar go znajdzie — także z podkreślnikami, nawiasami, symbolami, nazwami cyrylicą i CJK.",
      },
      {
        title: "Cechy artefaktu, dokładnie",
        text: "Na ekranie artefaktu Radar pokazuje każdą cechę artefaktu sezonu z tym, co naprawdę robi.",
      },
      {
        title: "Uzbrojenia pod skrótem",
        text: "Zakładaj uzbrojenia z gry i z DIM bez wychodzenia z gry albo zmieniaj cały preset naraz.",
      },
      {
        title: "DIM i Discord nad grą",
        text: "F6 otwiera twój Discord LFG, F7 otwiera DIM, prosto nad Destiny. Kody /join dostają przycisk, który je kopiuje.",
      },
      {
        title: "Nakładka, którą ustawiasz sam",
        text: "Zegar, statystyki sesji i powiadomienia trafiają tam, gdzie chcesz. Kliknięcia przechodzą prosto do gry.",
      },
      {
        title: "Startuje z Destiny",
        text: "Radar czeka w zasobniku systemowym i pojawia się razem z grą. Wszystko jest załadowane, zanim wylądujesz na orbicie.",
      },
      {
        title: "Nie spowalnia gry",
        text: "Radar ledwo obciąża twój PC: nakładka rysuje tylko tam, gdzie są jej widżety, a wszystko, czego nie używasz, jest wstrzymane.",
      },
    ],
  },
  safety: {
    kicker: "Bezpieczeństwo",
    title: "Ręce precz od gry.",
    text: "Radar działa obok Destiny 2, nie w niej. Patrzy na ekran i pyta Bungie — nic więcej.",
    items: [
      "Nigdy nie wysyła naciśnięcia klawisza ani kliknięcia do Destiny 2",
      "Nie czyta ani nie zmienia pamięci ani plików gry",
      "Czyta tylko to, co jest na ekranie, jak zrzut ekranu",
      "Twoje dane pochodzą z oficjalnego API Bungie, tak jak w DIM",
      "Twoje logowanie Bungie zostaje na twoim PC",
    ],
  },
  how: {
    kicker: "Jak to działa",
    title: "Gotowe w kilka minut.",
    steps: [
      { title: "Pobierz", text: "Pobierz instalator ({size}). Uprawnienia administratora nie są potrzebne." },
      { title: "Połącz z Bungie", text: "Zaloguj się raz kontem Bungie – bez kluczy, nic do konfigurowania." },
      {
        title: "Uruchom Destiny 2",
        text: "Radar pojawia się z grą w trybie okna bez ramki. F10 otwiera to, na co patrzysz, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Pytania i odpowiedzi.",
    items: [
      {
        q: "Czy mogę dostać bana za używanie Radaru?",
        a: "Radar niczego nie wstrzykuje, nie czyta pamięci gry i nigdy nie wysyła sterowania do Destiny 2. Czyta to, co jest na ekranie (jak zrzut ekranu), i korzysta z oficjalnego API Bungie — tak samo jak DIM i inne aplikacje towarzyszące.",
      },
      { q: "Czy jest darmowy?", a: "Tak. Radar można pobrać i używać za darmo." },
      {
        q: "Do czego służy logowanie Bungie?",
        a: "Logujesz się na stronie Bungie – Radar nigdy nie widzi twojego hasła. Dzięki temu Radar może czytać schowek i ekwipunek oraz przenosić i zakładać twój sprzęt. Logowanie zostaje na twoim PC.",
      },
      {
        q: "Czy nakładka obniża FPS?",
        a: "Trochę, jak każde okno nad grą. Radar ogranicza to, jak może: nakładka zakrywa tylko tę część ekranu, gdzie są jej widżety, czyta ekran tylko wtedy, gdy coś się zmieniło, i usypia DIM oraz Discord, gdy są ukryte. Możesz wyłączyć nakładkę i zachować całą resztę.",
      },
      {
        q: "Czy działa z każdą nazwą Strażnika?",
        a: "Radar czyta nazwy własnym, wbudowanym rozpoznawaniem — bez instalowania pakietów językowych. Symbole, nazwy cyrylicą i CJK też. Jeśli nazwa jest zbyt wymyślna, nadal możesz wyszukać gracza ręcznie.",
      },
      {
        q: "Jakimi językami mówi Radar?",
        a: "Polskim, angielskim, niemieckim, francuskim, hiszpańskim, włoskim, portugalskim (Brazylia) i rosyjskim – zmienisz to w każdej chwili w ustawieniach. Przedmioty i aktywności przychodzą z Bungie w tym samym języku.",
      },
      { q: "Jakie platformy?", a: "Windows 10 i 11, z Destiny 2 na Steamie lub w Epic Games Store w trybie okna bez ramki." },
      {
        q: "Czy Radar jest od Bungie?",
        a: "Nie. Radar to fanowska aplikacja towarzysząca, niezwiązana z Bungie ani przez nie niepopierana. Destiny jest znakiem towarowym Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Gotowy, kiedy ty jesteś,",
    titleAccent: "Strażniku.",
    text: "Pobierz Radar, uruchom Destiny 2, a wszystko będzie gotowe, gdy wylądujesz na orbicie.",
    button: "Pobierz na Windows",
    version: "Wersja {version}",
    installer: "Instalator {size}",
    windows: "Windows 10 / 11",
    free: "Za darmo",
  },
  footer: {
    legal: "Nota prawna",
    privacy: "Prywatność",
    disclaimer: "Niezwiązany z Bungie. Destiny 2 jest znakiem towarowym Bungie, Inc.",
  },
};

export default pl;
