# Katalog danych zawieszenia

## Przepływ aktualizacji

Aplikacja pobiera plik catalog-source.json przy uruchomieniu, po odzyskaniu połączenia i na żądanie użytkownika. Konfiguracja wskazuje publiczny endpoint JSON katalogu. Domyślnie jest to ścieżka względna catalog/catalog.json. Odświeżenie katalogu nie wymaga publikowania nowej wersji aplikacji.

Konfiguracja:

| Pole | Znaczenie |
| --- | --- |
| catalogUrl | Ścieżka względna w tej samej domenie albo pełny adres HTTPS do katalogu |
| refreshEveryHours | Minimalny odstęp między automatycznymi próbami po ponownym otwarciu aplikacji, od 1 do 168 godzin |
| requestTimeoutMs | Limit czasu pobierania katalogu, od 1000 do 30000 ms |

Zewnętrzny endpoint musi udostępniać JSON przez HTTPS i zezwalać na odczyt z domeny aplikacji przez CORS. Plik konfiguracyjny oraz bieżący wskaźnik katalogu powinny mieć Cache-Control: no-store albo no-cache, must-revalidate. Wersjonowane pliki katalogu mogą być niezmienne.

## Format katalogu

Format i przykładowe dane są w catalog/catalog.json; walidator schematu to catalog/catalog.schema.json.

- schemaVersion opisuje format dokumentu.
- catalogVersion jest wersją semantyczną publikacji, a revision jest ściśle rosnącym numerem rewizji.
- publishedAt i sources[].retrievedAt są datami UTC w ISO 8601.
- Wpis modelu identyfikuje markę i dokładną nazwę. `year` może być liczbą dla potwierdzonego rocznika albo `null`, gdy źródło potwierdza nazwę modelu, ale nie wskazuje rocznika. Wpis z `year: null` służy tylko do rozpoznawania nazwy; nie może zawierać nastaw ani specyfikacji. Aplikacja wymaga od użytkownika podania jego rocznika przy obliczaniu.
- status może być unverified lub verified.
- Wpis unverified musi mieć pustą listę settings. Aplikacja pokazuje wtedy „Brak zweryfikowanych danych”.
- Pole specifications może zawierać źródłowe parametry techniczne oddzielone od nastaw. Aktualnie obsługiwany typ to kind: travel, ze stroną front/rear, dodatnią wartością w milimetrach oraz sourceIds. Skok zawieszenia jest wartością wejściową do obliczenia, a nie nastawą ani zaleceniem.
- Każda nastawa w wpisie verified wymaga co najmniej jednego sourceId wskazującego na źródło przypisane do tego modelu.
- Źródło wymaga tytułu, adresu HTTPS oraz daty sprawdzenia. Dodaj notatkę z kontekstem, jeżeli dokument nie obejmuje wszystkich warunków jazdy lub regulacji.
- Wartości nastaw są tekstem lub liczbą; pole context doprecyzowuje pozycję wyjściową, kierunek obrotu i warunek obciążenia. Są wyświetlane jako dane z podanego źródła, a nie jako uniwersalna rekomendacja.
- Kalkulator pozwala opcjonalnie wpisać cel ugięcia odczytany z instrukcji. Porównuje z nim wynik i wskazuje kierunek zmiany napięcia wstępnego, ale nie wylicza liczby obrotów ani klików.
- Obliczenie kierunku jest ogólną relacją: większe napięcie wstępne zmniejsza ugięcie, mniejsze napięcie zwiększa ugięcie. Użytkownik powinien stosować się do zakresu i procedury w instrukcji danego motocykla.

Do źródeł wybieraj dokumentację producenta, instrukcję serwisową lub inne źródło, które bezpośrednio potwierdza konkretną wartość dla danego rocznika. Nie przenoś ustawień pomiędzy modelami ani rocznikami bez źródła. Karty sprzedażowe nie są źródłem fabrycznych klików ani zaleceń nastaw.

## Publikacja i walidacja

1. Skopiuj bieżący katalog do nowego, niezmiennego pliku, na przykład catalog/releases/1.0.1.json.
2. Edytuj nowy plik. Dodaj źródło przed przypisaniem jego identyfikatora do nastawy.
3. Zwiększ catalogVersion oraz revision; ustaw publishedAt na czas publikacji UTC.
4. Uruchom node scripts/validate-catalog.mjs catalog/releases/1.0.1.json.
5. Opublikuj nowy plik, a następnie zmień catalog-source.json tak, aby wskazywał nowy plik.
6. Otwórz aplikację online. Katalog sprawdzi się sam; opcjonalnie można wybrać „Odśwież teraz”. Sprawdź markę, model, rocznik i cytowane źródła.

Aplikacja weryfikuje strukturę, marki, rewizję, daty, źródła i relacje cytowań. Nie zastępuje to merytorycznego sprawdzenia nastaw przez osobę utrzymującą katalog.

## Automatyczna aktualizacja bez działania klienta

Aplikacja sama sprawdza katalog przy każdym otwarciu online, po odzyskaniu połączenia oraz co 12 godzin, gdy pozostaje otwarta. Przycisk „Odśwież teraz” jest wyłącznie opcjonalny. Ostatnia poprawna wersja pozostaje dostępna offline.

GitHub Actions raz dziennie uruchamia `scripts/refresh-model-catalog.mjs`. Skrypt sprawdza oficjalne listy modeli: [VOGE Polska](https://voge.pl/modele) i [archiwalne modele VOGE](https://voge.pl/modele-archiwalne), [katalog ZONTES](https://www.zontes.com/en/Products/ProductsList.aspx) oraz [katalog KOVE](https://www.kovemoto.com/models). Przy zmianie dopisuje wyłącznie nowe nazwy modeli. Nowy wpis nie otrzymuje roku, specyfikacji ani nastaw, których strona katalogowa nie potwierdza.

Podgląd lokalny:

```sh
node scripts/refresh-model-catalog.mjs
```

Workflow używa `--write`; lokalnie ta flaga dopisuje brakujące nazwy do `catalog/catalog.json`:

```sh
node scripts/refresh-model-catalog.mjs --write
node scripts/validate-catalog.mjs
```

Skrypt nie usuwa istniejących modeli. Wykrywa brak strony, błąd pobrania, pusty wynik i spadek liczby rozpoznanych pozycji poniżej bezpiecznego progu; w takich sytuacjach kończy się błędem bez zapisu. Każda nazwa otrzymuje link do właściwej strony producenta. Nowy wpis ma `year: null`, status `unverified` oraz puste listy nastaw i specyfikacji. Karty sprzedażowe BigBikes nie są źródłem fabrycznych nastaw.

Nastawy są publikowane wyłącznie po sprawdzeniu instrukcji producenta dla zgodnego modelu, rocznika i wersji. Walidator publikacji i aplikacja odrzucają nastawy przypisane do domeny spoza listy oficjalnych stron danej marki. Jeśli producent zmieni domenę albo udostępni instrukcję na nowym oficjalnym serwerze, dodaj ją do listy w `scripts/validate-catalog.mjs` i `app.js` dopiero po potwierdzeniu, że to źródło producenta. Strony marek i instrukcje mają różne formaty, dlatego automatyczny skrypt nie zgaduje liczby klików z tekstu ani nie przenosi nastaw między modelami. Jeśli producent nie podaje czytelnej wartości, aplikacja pokazuje „Brak zweryfikowanych danych”. Nowy katalog nastaw można opublikować jako JSON bez przebudowy aplikacji; klient pobierze go automatycznie.

Workflow `.github/workflows/refresh-model-catalog.yml` uruchamia się codziennie o 03:20 UTC. Po wykryciu nowej nazwy waliduje katalog, zwiększa wersję i rewizję oraz zapisuje zmiany w repozytorium. Harmonogram wymaga repozytorium GitHub, aktywnych Actions oraz uprawnienia **Read and write permissions**. Aby klient zobaczył nowy plik bez czekania na ręczne FTP, adres z `catalog-source.json` musi wskazywać katalog publikowany automatycznie z repozytorium albo zewnętrzny endpoint aktualizowany przez pipeline. Samo zapisanie nowego pliku w repozytorium nie wgrywa go na niezależny hosting FTP.

Wykrywanie nowych nazw i pobieranie katalogu są oddzielnymi etapami: workflow raz dziennie czyta strony marek, a aplikacja automatycznie pobiera opublikowany katalog. Stare modele pozostają w katalogu, także po wycofaniu z oferty. Automatyczne sprawdzanie obejmuje archiwalne listy producenta tam, gdzie marka taką listę publikuje.

## Zachowanie przy błędzie i wycofanie

Nowy katalog jest walidowany przed zapisaniem. Niepoprawny JSON, brak źródła, zmiana treści przy tej samej rewizji albo rewizja niższa niż lokalnie zapisana nie zastąpią ostatniego poprawnego katalogu. Kalkulator nadal działa offline, a interfejs pokazuje użycie kopii lub błąd aktualizacji.

Aby cofnąć niepoprawną publikację, opublikuj znaną poprawną zawartość jako nową wersję i nową, wyższą rewizję, a następnie przestaw wskaźnik. Nie publikuj starszego numeru rewizji: chroni to urządzenia, które już pobrały nowszą wersję, przed przypadkowym nadpisaniem jej starą odpowiedzią z cache.

## Kontrakt HTTP

- Metoda odczytu: GET, Accept: application/json, bez danych użytkownika.
- Sukces: status 200, Content-Type: application/json; charset=utf-8.
- Błąd lub niedostępność: dowolny status poza 2xx, niekompletny JSON albo przekroczenie limitu czasu. Klient zachowuje ostatni poprawny katalog.
- Nie udostępniaj endpointu zapisu administracyjnego publicznie. Wdrożenie pliku może odbywać się przez uprawniony hosting lub pipeline publikacji.
- Endpointy między domenami muszą mieć poprawne CORS. Do aplikacji i service workera wymagany jest HTTPS; localhost służy wyłącznie do lokalnego podglądu.
