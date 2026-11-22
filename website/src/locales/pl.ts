import type { Strings } from "../i18n";

const pl: Strings = {
  nav: { tour: "Prezentacja", features: "Funkcje", safety: "Bezpieczeństwo", faq: "FAQ", download: "Pobierz", language: "Język" },
  hero: {
    badge: "Za darmo na Windows · v{version}",
    title: "Zobacz to, czego gra",
    titleAccent: "ci nie powie.",
    text: "Wszystko o twoim Strażniku, tuż obok gry. Radar rozpoznaje broń, pancerz lub Strażnika, na którego patrzysz, i pokazuje to, czego gra nie pokazuje: każdy roll, dokładne wartości, ukończenia, lowmany i buildy. Do tego wszystkie uzbrojenia w jednym miejscu, a DIM i Discord pod jednym skrótem.",
    download: "Pobierz na Windows",
    tour: "Zobacz prezentację",
    meta: "{size} · Windows 10/11 · Niezwiązany z Bungie",
    inAction: "Zobacz w akcji",
  },
  tour: {
    kicker: "Prezentacja",
    title: "Przewiń prawdziwą aplikację.",
    text: "Rozdział po rozdziale, od twojej drużyny po nakładkę w grze.",
    chapters: [
      {
        name: "Drużyna",
        title: "Wiedz, z kim grasz.",
        text: "Ukończenia, lowmany, najlepsze czasy i build każdego Strażnika – twój, twojej drużyny i każdego, kogo wyszukasz.",
      },
      {
        name: "Baza danych",
        title: "Każda broń i część pancerza, z prawdziwymi liczbami.",
        text: "Wszystkie rolle, źródła i dokładne wartości cech, obok egzemplarzy, które masz.",
      },
      {
        name: "Uzbrojenia",
        title: "Wszystkie twoje uzbrojenia w jednym miejscu.",
        text: "Sloty w grze, uzbrojenia DIM i presety – zakładaj je, zapisuj i twórz bez wychodzenia z Radaru.",
      },
      {
        name: "Optymalizator pancerza",
        title: "Najlepszy pancerz pod statystyki, których chcesz.",
        text: "Ustaw cele, a Radar przeszuka cały twój schowek i znajdzie buildy, które je osiągają.",
      },
      {
        name: "W grze",
        title: "Prosto nad grą.",
        text: "Najedź na broń lub część pancerza jak w grze: Radar ją rozpozna i pokaże powiadomienie. Kliknij ją lub naciśnij F10, aby otworzyć stronę Radaru. Otwórz też artefakt.",
      },
    ],
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
        points: ["Załóż dowolne uzbrojenie jednym kliknięciem", "Zapisz uzbrojenie z gry w DIM pod nazwą", "Presety, które zmieniają kilka uzbrojeń naraz"],
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
      {
        title: "Stwórz uzbrojenie",
        subtitle: "Slot po slocie – broń, pancerz, podklasa i artefakt",
        points: [
          "Zacznij od tego, co masz na sobie, albo od zera",
          "Broń z cechami, które wybierzesz, ustawianymi przy zakładaniu",
          "Zapisz je i załóż później jednym kliknięciem",
        ],
      },
      {
        title: "Pancerz pod statystyki, których chcesz",
        subtitle: "Ustaw minima, a Radar połączy części z całego schowka",
        points: [
          "Pokazuje, jak wysoko może jeszcze wejść każda statystyka",
          "Liczy się każda część na twoich postaciach i w schowku",
          "Arcydzieło, modyfikacje i strojenie poziomu 5 wliczone",
        ],
      },
      {
        title: "Twój build, twoje zasady",
        subtitle: "Egzotyk, premie zestawu i stałe modyfikacje – reszta jest liczona wokół nich",
        points: [
          "Wybierz egzotyk – albo pozwól wybrać Radarowi",
          "Zażądaj premii zestawu: tyle części trafi do każdego buildu",
          "Sam ustal część lub modyfikację albo którąś wyklucz",
        ],
      },
      {
        title: "Każdy build w szczegółach",
        subtitle: "Co daje każda część, ile to kosztuje i co dostajesz",
        points: [
          "Statystyki każdej części: roll, arcydzieło, modyfikacje i strojenie",
          "Ile kosztowałoby doprowadzenie buildu do arcydzieła",
          "Czasy odnowienia umiejętności i odporność na obrażenia przy tych statystykach",
        ],
      },
    ],
    tryIt: "Kliknij aplikację, aby wypróbować ją samodzielnie.",
    tryItHint: "Demo z przykładowymi danymi (po angielsku) – niektóre funkcje działają tylko w prawdziwej aplikacji.",
    swipe: "Nagrania z prawdziwej aplikacji",
    demo: "Demo Radaru",
    clickToTry: "Kliknij, aby wypróbować",
    backToTour: "Wróć do prezentacji",
  },
  game: {
    note: "Narysowany ekran gry z przykładowym ekwipunkiem; powiadomienie i strona nad nim to prawdziwy Radar · Destiny 2 tutaj nie działa",
    hover: "Najedź",
    inspect: "Obejrzyj",
    page: "Strona Radaru",
    close: "Zamknij",
    tip: "Kliknięcie lub F10: strona Radaru",
  },
  features: {
    kicker: "I jeszcze",
    title: "Jedna aplikacja zamiast pięciu kart.",
    text: "Stworzona dla Destiny 2 na PC, tak by nie wchodzić ci w drogę.",
    items: [
      {
        title: "Czyta nazwy Strażników",
        text: "Otwórz czyjś ekran postaci, a Radar go znajdzie — także z podkreślnikami, nawiasami, symbolami, nazwami cyrylicą i CJK.",
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
      {
        title: "W twoim kolorze",
        text: "Wybierz kolor podklasy albo własny – aplikacja i nakładka pójdą za nim.",
      },
      {
        title: "Makra",
        text: "Twórz sekwencje umiejętności, klawiszy, przycisków myszy i pauz i przypisz je do skrótu albo Myszy 4/5 – raz, przytrzymane lub przełączane. Korzystają z klawiszy ustawionych w grze.",
      },
      {
        title: "Zmiana klawiszy w grze",
        text: "Zmieniaj klawisze Destiny bezpośrednio w Radarze, z wyszukiwaniem po wszystkich akcjach. Jeśli chcesz, zabezpiecz je przed zapisem, żeby gra ich nie zresetowała.",
      },
    ],
  },
  safety: {
    kicker: "Bezpieczeństwo",
    title: "Obok gry, nie w niej.",
    text: "Radar działa obok Destiny 2, nie w niej. Patrzy na ekran, pyta Bungie i przy makrach naciska klawisze tak, jak ty na klawiaturze.",
    items: [
      "Nigdy nie czyta ani nie zmienia pamięci gry. Zmienia twoje klawisze tylko wtedy, gdy robisz to w Radarze.",
      "Czyta tylko to, co jest na ekranie, jak zrzut ekranu",
      "Twoje dane pochodzą z oficjalnego API Bungie, tak jak w DIM",
      "Twoje logowanie Bungie zostaje na twoim PC",
      "Open source: cały kod jest publiczny na GitHubie",
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
        a: "Radar nie umieszcza w grze żadnego kodu i nie czyta jej pamięci. Czyta to, co jest na ekranie (jak zrzut ekranu), i korzysta z oficjalnego API Bungie, tak jak DIM. Makra naciskają klawisze tak, jakbyś robił to sam.",
      },
      { q: "Czy jest darmowy?", a: "Tak. Radar można pobrać i używać za darmo." },

      { q: "Czy Radar jest open source?", a: "Tak. Cały kod źródłowy Radara jest publiczny na GitHubie – github.com/Niklas2654/D2Radar – na licencji GPL-3.0. Kod każdej wydanej wersji jest tam publikowany." },
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


    openSource: "Open source",
    downloads: "{n} pobrań",
    downloadsLive: "Liczone na żywo",
    active: "{n} aktywnych Strażników",
    activeLive: "Konta Bungie, które używały Radara w ostatnich 30 dniach – liczone na żywo",
  },
  footer: {
    legal: "Nota prawna",
    privacy: "Prywatność",

    source: "Kod źródłowy",
    disclaimer: "Niezwiązany z Bungie. Destiny 2 jest znakiem towarowym Bungie, Inc.",
  },
};

export default pl;
