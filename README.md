# BigBikes · Kalkulator zawieszenia

Lekka, statyczna aplikacja PWA po polsku dla BigBikes Gostyń Śląsk. Działa na telefonach i komputerach, oblicza ugięcie z pomiarów użytkownika, porównuje je z celem wpisanym z instrukcji i podaje kierunek korekty napięcia wstępnego. Fabryczne nastawy i kierunki regulatorów pokazuje tylko przy przypisanym, sprawdzalnym źródle.

## Zawartość

- index.html, styles.css, app.js — interfejs i kalkulator.
- manifest.webmanifest, sw.js, icons/ — instalacja i pamięć podręczna aplikacji.
- assets/bigbikes-logo.png — przekazane logo używane w interfejsie i ikonach instalacyjnych.
- catalog-source.json, catalog/catalog.json — konfiguracja endpointu i początkowy katalog.
- catalog/catalog.schema.json, scripts/validate-catalog.mjs — kontrakt i walidator.
- docs/CATALOG_API.md — publikowanie katalogu, API i rollback.
- _headers — polityki cache dla hostingów obsługujących ten format pliku.

Katalog ma 104 wpisy obejmujące 91 nazw modeli marek VOGE, ZONTES i KOVE: aktualne polskie gamy producentów/importerów, modele archiwalne VOGE, modele z globalnych katalogów ZONTES i KOVE oraz modele wystawione w BigBikes. Gdy źródło potwierdza nazwę, ale nie rocznik konkretnej wersji, wpis ma `year: null`; kalkulator rozpoznaje nazwę, lecz nadal wymaga rocznika podanego przez klienta. Wpisy bez potwierdzonego rocznika nie zawierają nastaw ani specyfikacji zawieszenia. Katalog można aktualizować osobnym plikiem JSON bez publikowania nowej wersji aplikacji.

Zweryfikowane parametry techniczne są oparte na stronach producentów: VOGE 900 DSX (skok 194/198 mm), ZONTES 703F MY26 (180/180 mm), KOVE 800X Pro (240/240 mm), KOVE 800X Touring (210/210 mm), KOVE 450 Rally RE (305/300 mm w konfiguracji wysokiej; 255/270 mm w niskiej) oraz przedni skok VOGE 525 DSX (150 mm; producent nie podaje tu tylnego skoku). Nastawy zawieszenia pokazujemy wyłącznie po przypisaniu instrukcji producenta. Katalog zawiera pozycje standardowe KOVE 800X Pro 2026 i VOGE 900 DSX E5+; aplikacja dobiera jedną z trzech dokładnych sytuacji obciążenia VOGE na podstawie obecności pasażera i liczby kufrów. Dla pozostałych obciążeń nie interpoluje klików z kilogramów. Waga i wzrost kierowcy, pasażer i bagaż są widoczne jako kontekst obciążenia, a suma masy osób i bagażu jest obliczana. Wzrost sam w sobie nie wyznacza ustawienia klików. Dla pozostałych modeli można wpisać wartości z instrukcji konkretnej wersji; takie wpisy są oznaczone jako własne i zapisują się lokalnie.

W kalkulatorze można opcjonalnie wpisać docelowe ugięcie z instrukcji. Aplikacja porównuje je z pomiarem i wskazuje, czy do zmniejszenia lub zwiększenia ugięcia potrzebna jest korekta napięcia sprężyny. Kliknięcia ustawia się osobno — z właściwej bazy producenta albo wartości odczytanych z instrukcji danego motocykla.

Przy modelach bez potwierdzonych nastaw pojawia się prywatny notatnik ustawień. Zapisane wartości są przechowywane lokalnie w przeglądarce urządzenia, osobno dla marki, modelu i rocznika. Nie są wysyłane do serwera ani traktowane jako zalecenia fabryczne. Wpisuj wyłącznie nastawy ustalone z instrukcji właściwej wersji lub z serwisem.

## Podgląd lokalny

Otwórz katalog przez lokalny serwer HTTP, a nie przez file://. Service worker i instalacja działają na HTTPS albo na localhost. Projekt nie wymaga bibliotek zewnętrznych. Ikony można odtworzyć poleceniem `node scripts/build-icons.mjs` po podmianie źródła logo w `assets/bigbikes-logo.png`.

Podgląd przy użyciu dołączonego serwera Node.js:

1. W katalogu projektu uruchom node scripts/serve.mjs.
2. Otwórz http://localhost:8080.

## Darmowa publikacja w GitHub Pages

Projekt zawiera workflow `.github/workflows/deploy-pages.yml`. Publikuje on aplikację po każdym wypchnięciu zmian na gałąź `main`. Do strony trafiają tylko pliki potrzebne aplikacji i katalogowi; materiały źródłowe oraz pliki administracyjne pozostają poza opublikowaną witryną.

1. Utwórz publiczne repozytorium na GitHubie, np. `bigbikes-kalkulator`, i wgraj do niego pliki z paczki ZIP z zachowaniem katalogów oraz folderu `.github`. Repozytorium musi być publiczne w darmowym planie GitHub Pages.
2. W repozytorium otwórz **Settings → Pages**. W polu **Build and deployment → Source** wybierz **GitHub Actions**.
3. Otwórz **Settings → Actions → General → Workflow permissions**, wybierz **Read and write permissions** i zapisz. To pozwala codziennemu sprawdzaniu producentów zapisywać nowe nazwy modeli w katalogu.
4. Otwórz kartę **Actions** i włącz workflows, jeśli GitHub o to poprosi. Workflow publikacji uruchomi się po dodaniu plików lub można go uruchomić ręcznie z listy **Deploy BigBikes PWA to GitHub Pages**.
5. Po udanym wdrożeniu otwórz adres z sekcji **Settings → Pages** lub z podsumowania wdrożenia. Będzie wyglądać mniej więcej tak: `https://twojanazwa.github.io/bigbikes-kalkulator/`.

Codzienny workflow katalogu dopisuje wyłącznie modele znalezione w oficjalnych źródłach. Jego commit na `main` uruchomi publikację Pages, a aplikacja pobierze nowy katalog automatycznie. Niepotwierdzone ustawienia zawieszenia nadal nie są generowane.

Na iPhonie otwórz stronę w Safari i wybierz **Udostępnij → Dodaj do ekranu początkowego**. Na Androidzie otwórz ją w Chrome i wybierz **Zainstaluj aplikację** lub **Dodaj do ekranu głównego**.

## Publikacja na innym hostingu

1. Wgraj pliki aplikacji z zachowaniem ścieżek katalogów do katalogu publicznego hostingu statycznego. Katalog `.github/` zawiera harmonogram dla repozytorium GitHub; nie jest potrzebny na hostingu FTP. Jeśli hosting obsługuje plik _headers, wgraj go razem z aplikacją; w przeciwnym razie ustaw równoważne nagłówki w panelu hostingu.
2. Włącz HTTPS dla domeny i otwórz opublikowaną stronę raz online.
3. Ustaw dla sw.js i catalog-source.json nagłówki Cache-Control: no-cache, must-revalidate. Podobnie obsłuż HTML/JS/CSS po wdrożeniu nowej wersji aplikacji. Nie cache'uj bieżącego wskaźnika katalogu na długo.
4. Upewnij się, że hosting serwuje .webmanifest jako application/manifest+json, a pliki JSON jako application/json.
5. Do późniejszej aktualizacji danych wgraj nowy plik katalogu i zmień tylko catalog-source.json; nie trzeba przebudowywać aplikacji.
6. Sprawdź instalację z menu przeglądarki. Na iOS dodanie do ekranu głównego wykonuje się w Safari.

Gdy zmieniasz interfejs aplikacji, zwiększ nazwę SHELL_CACHE w sw.js, zmień parametr wersji w odnośnikach app.js i styles.css w index.html oraz opublikuj pliki razem. Przy samych zmianach katalogu nie ruszaj service workera. Zaktualizowany service worker pobiera pliki skryptu i stylów z sieci z kopią awaryjną na offline.

Po pierwszym pobraniu app shell jest dostępny offline. Ostatni poprawny katalog jest zapisywany lokalnie po walidacji. Katalog i konfiguracja są pobierane ponownie przy uruchomieniu, po powrocie sieci albo przez przycisk w aplikacji.

Szczegółowy kontrakt i procedura aktualizacji znajdują się w docs/CATALOG_API.md.

## Automatyczne dopisywanie modeli

`scripts/refresh-model-catalog.mjs` sprawdza codziennie oficjalne listy VOGE, ZONTES i KOVE przez GitHub Actions (`.github/workflows/refresh-model-catalog.yml`). Nowe nazwy modeli trafiają do katalogu bez niepotwierdzonych nastaw. Aplikacja pobiera zmiany automatycznie przy otwarciu i co 12 godzin; klient salonu nie musi niczego klikać. Nastawy pochodzą z instrukcji producentów, nigdy z kart sprzedażowych BigBikes. Jeżeli instrukcja dla konkretnego modelu i rocznika nie jest zweryfikowana, aplikacja nie pokazuje fabrycznych klików.

Aby uruchomić harmonogram, umieść projekt w repozytorium GitHub z włączonymi Actions i ustaw w repozytorium uprawnienie Actions **Read and write permissions**. Repozytorium lub endpoint `catalogUrl` musi udostępniać nowy plik katalogu aplikacji. Przy hostingu aktualizowanym wyłącznie ręcznym FTP harmonogram zapisze katalog w GitHub, ale nie wgra go na serwer — do pełnej automatyzacji trzeba połączyć hosting z publikacją z repozytorium. Instrukcje i polecenie podglądu są w docs/CATALOG_API.md.
