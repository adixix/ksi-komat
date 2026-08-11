# AGENTS.md — Książkomat

Przewodnik dla agentów/asystentów pracujących w tym repozytorium.

## Opis projektu

Książkomat to domowy spis inwentaryzacyjny biblioteczki (PWA). Pozwala:
- dodawać książki ręcznie, po ISBN (Open Library) lub przez skaner kodu kreskowego,
- przeglądać półkę (wyszukiwanie, filtry, statusy, edycja),
- wykrywać **brakujące książki autorów** z półki oraz **nowsze wydania** posiadanych tytułów,
- śledzić wyniki w aplikacji oraz przez kanał RSS (fundament pod powiadomienia e-mail).

Interfejs i komunikaty są w języku polskim.

## Stack

- **Backend:** Node.js 20 (ESM, `"type": "module"`), Express 4, `mysql2` (MariaDB), `express-session` (MemoryStore), `bcryptjs`
- **Frontend:** React 18 + Vite 5, `html5-qrcode` (skaner ISBN), PWA (manifest + service worker), czysty CSS (bez frameworków UI)
- **Baza danych:** zdalna **MariaDB** (host `przyba.pl`, port 3306, baza `ksiazkomat`, user `ksiazkomat`). Kodowanie: `utf8mb4` / `utf8mb4_unicode_ci` (zweryfikowane — poprawne).
- **Źródło danych książek:** Open Library API (bez klucza). Base URL z env `OPENLIBRARY_BASE`. Gdy OL nie zna ISBN, używany jest **fallback BN (Biblioteka Narodowa)** (`server/src/bn.js`, `data.bn.org.pl`, bez klucza; czyste metadane PL + tytuł oryginału, bez okładek/kluczy OL — dokleja je `enrichBN` w `ol.js`), potem **Google Books API** (`server/src/googlebooks.js`, klucz z env `GOOGLE_BOOKS_API_KEY`, opcjonalny — bez klucza fallback wyłączony; wynik nie ma `author_key`/`work_key`) i **Wikidata** (`server/src/wikidata.js`, bez klucza) — wyszukiwanie po tytule z okładkami z Commons i kluczami OL (P648). Kolejność fallbacków ISBN: **OL → BN → Google → Wikidata**.

## Komendy

Z katalogu głównego repozytorium:

```bash
npm install            # zależności roota (concurrently)
npm run install:all    # instalacja server/ i client/
npm run dev            # API :3001 + Vite :5173 (proxy /api i /feed.rss)
npm run build          # build clienta do client/dist
npm run start          # serwer produkcyjny (serwuje client/dist) — ustaw NODE_ENV=production
npm run db:migrate     # uruchom migracje SQL z server/migrations/
```

Brak skonfigurowanego lintera/testów — walidacja to `npm run build` oraz ręczne testy przez curl.

## Konfiguracja

- Konfiguracja w `server/.env` (wzór: `server/.env.example`). `.env` jest w `.gitignore`.
- Kluczowe zmienne: `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, `SESSION_SECRET`, `PORT`, `FEED_TOKEN`, `OPENLIBRARY_BASE`.
- W środowisku produkcyjnym `NODE_ENV=production` + `trust proxy` (HTTPS za reverse proxy). Cookie sesji: `secure: 'auto'`, `sameSite: 'lax'`.

## Baza danych — schemat

Tabele (InnoDB, utf8mb4_unicode_ci), tworzone przez `server/migrations/` (runner: `server/src/migrate.js`, rejestr w tabeli `schema_migrations`):

- `users` (id, email UNIQUE, password_hash, created_at)
- `books` (id, user_id FK→users, isbn VARCHAR(20), title, author, author_key, work_key, publisher, publish_year, cover_url, edition, notes, status ENUM('owned','wanted','loaned','read') DEFAULT 'owned', created_at)
- `notification_events` (id, user_id, book_id, kind ENUM('missing_book','new_edition'), payload JSON, created_at, seen TINYINT)
- `ol_cache` (key PK, data MEDIUMTEXT, fetched_at) — cache odpowiedzi Open Library z TTL

Nowy plik SQL w `server/migrations/` z prefiksem numerycznym (np. `002_*.sql`) — zostanie uruchomiony automatycznie przy `npm run db:migrate`.

## API

- `POST /api/auth/register|login|logout`, `GET /api/auth/me`
- `GET /api/books` (query: `q`, `author`, `status`, `sort` ∈ `author|title|year|created|status` domyślnie `author`, `dir` ∈ `asc|desc`), `POST /api/books` (ISBN lub pełne dane), `POST /api/books/lookup` (podgląd danych z OL bez zapisu), `POST /api/books/resolve-author` (autor → klucz OL po nazwisku; OL z fallbackiem na Wikidata), `POST /api/books/cover-search` (wyszukiwanie okładek w OL po `title`/`author` do wyboru w UI — `searchCovers` w `ol.js`), `POST /api/books/gb-search` (szukanie po tytule w Google Books), `POST /api/books/wikidata-search` (szukanie po tytule w Wikidacie z okładkami i kluczami OL z P648), `POST /api/books/wikidata-covers` (okładki z Commons), `PUT/DELETE /api/books/:id`, `GET /api/books/authors`
- `GET /api/discovery/missing`, `GET /api/discovery/new-editions`, `POST /api/discovery/refresh` (zapisuje do `notification_events`; zwraca też `resolvedAuthors` — liczba uzupełnionych `author_key` przez backfill), `GET /api/discovery/notifications`, `POST /api/discovery/notifications/:id/seen`
- `GET /feed.rss?token=<FEED_TOKEN>` (RSS 2.0, bez autoryzacji sesyjnej)
- Auth: sesja oparta o cookie; endpointy `/api/books` i `/api/discovery` wymagają `req.session.userId`.
- Odpowiedzi błędów: `{ "error": "komunikat po polsku" }`.

## Open Library — jak to działa (ważne!)

`server/src/ol.js` — klient z cache (TTL: isbn 14 dni, works/editions 7 dni).

**Klucze Open Library mają prefiksy** (`/authors/OL...`, `/works/OL...`, `/books/OL...`). Zapisujemy je do DB z prefiksem (np. `work_key = '/works/OL81633W'`), ale przy budowaniu URL **trzeba prefiks usunąć** (funkcja `stripPrefix` w `ol.js`) — inaczej URL jest z podwójnym prefiksem i OL zwraca 404.

Wzorce endpointów:
- ISBN → `GET {BASE}/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data` (metadane + klucz edycji `key`)
- klucze work/author edycji → `GET {BASE}{editionKey}.json` (pola `works[0].key`, `authors[0].key`)
- dzieła autora → `GET {BASE}/authors/{key}/works.json?limit=500`
- wydania dzieła → `GET {BASE}/works/{key}/editions.json?limit=200` (pola `publish_date`, `isbn_13`/`isbn_10`, `covers`)

Rok wydania wyciągamy z `publish_date` regexem `\b(19|20)\d{2}\b` (`parseYear` w `routes/books.js`).

**Rozpoznawanie autora po nazwisku** (`resolveAuthorByName` w `ol.js`): `GET {BASE}/search/authors.json?q=<nazwisko>&limit=5`, dopasowanie po znormalizowanej nazwie (małe litery, bez diakrytyków). Obsługuje też formę „Nazwisko, Imię" (porównanie z odwróconą kolejnością — OL trzyma „Imię Nazwisko"). Używane:
- w `POST /api/books` i `PUT /api/books/:id`, gdy brakuje `author_key` (ręcznie wpisany autor),
- jako backfill w `POST /api/discovery/refresh` dla książek z `author_key IS NULL` (zwraca `resolvedAuthors`).
- W UI: przycisk „Znajdź w OL" przy polu autora (`POST /api/books/resolve-author`).

**Fallback w lookupie ISBN:** gdy rekord ISBN w OL nie ma autora, `ol.js` szuka go po tytule (`GET {BASE}/search.json?q=title:...&fields=key,title,author_name,author_key,isbn,first_publish_year`), dopasowując po znormalizowanym tytule, potem po ISBN, potem po roku wydania. Wynik trafia do `resolved_author_name` w odpowiedzi lookupu i jest zapisywany jako `author` + `author_key`.

Uwaga: `ol_cache` ma TTL (isbn 14 dni) — zmiany logiki parsowania nie obejmą już zbuforowanych wpisów; przy testowaniu nowych zachowań wyczyść `ol_cache`. Wartości `null` nie są cache'owane (chwilowy błąd API nie blokuje poprawnego wyniku na TTL).

**Fallback Google Books** (`googlebooks.js`): `GET {BASE}/volumes?q=isbn:{isbn}&key={klucz}` — używany w `POST /api/books/lookup` i `POST /api/books`, gdy OL i BN nie znają ISBN. Wynik ma `author_key: null` i `work_key: null` (Google nie podaje kluczy OL). Cache: `google-isbn:{isbn}`, tylko wyniki niepuste.

**Fallback BN (Biblioteka Narodowa)** (`bn.js`, `getBookByISBN`): `GET https://data.bn.org.pl/api/institutions/bibs.json?isbnIssn={isbn}` — używany w `POST /api/books/lookup` i `POST /api/books`, gdy OL nie zna ISBN (dobre pokrycie niszowych polskich wydań). Parsowanie z pola `marc`: `245a`+`245b` → tytuł (ucięte końcowe ` / : ,`), `100a` → autor (daty z `100d` obcinane), `246a`+`246b` → `originalTitle` (tytuł oryginału), `260b` → wydawca (ucięty przecinek), rok z `publicationYear`/`260c`. Bez okładek i bez kluczy OL — dokleja je **`enrichBN`** w `ol.js`: dokładne dopasowanie tytułu PL w `search.json` → `workKey` + `coverUrl` (fallback po `originalTitle`), a `authorKey` przez `resolveAuthorByName`. Cache: `bn-isbn:{isbn}` (TTL 7 dni).

**Fallback Wikidata po ISBN** (`wikidata.js`, `getBookByISBN`): gdy OL, BN i Google nie znają ISBN — SPARQL po **P212** (ISBN-13) / **P957** (ISBN-10), z obsługą zapisu z myślnikami w Wikidacie (próba bez i z myślnikami). Zwraca `isbn/title/author/authorKey/workKey/publisher/publishYear/coverUrl` (P648 → klucze OL, gdy są). Cache: `wd-isbn:{isbn}`. Używany w `POST /api/books/lookup` i `POST /api/books`.

**Transkrypcja autora z cyrylicy** (`wikidata.js`): gdy autor zawiera cyrylicę (np. rosyjski), w `lookup`/`POST`/`PUT /api/books` dopisujemy formę łacińską w nawiasie, np. „Дмитрий Глуховский (Dmitrij Głuchowski)". Kolejność źródła (`getAuthorLatinName`): **pl label** z Wikidaty (przez `olAuthorToQid` + `getEntities`) → **en label** → determinystyczna transkrypcja **GOST** (`transliterateGost`). `author_key`/`work_key` bez zmian — wykrywanie braków/nowych wydań działa po kluczach.

## Wikidata — jak to działa

`server/src/wikidata.js` — klient bez klucza API, cache w `ol_cache` (klucze `wd:*`, TTL 7 dni; `null` nie cache'owane).

Wzorce endpointów:
- wyszukiwanie po tytule → `GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<fraza>&language=pl&type=item&limit=8` (szuka po tytule; **autor w frazie pogarsza wyniki** — podajemy tytuł, a autora filtrujemy przez claims),
- dane encji (batch do 50 QID) → `action=wbgetentities&ids=Q1|Q2&props=claims|labels&languages=pl|en`
- dzieła autora / odwrotne mapowanie OL→QID → SPARQL `https://query.wikidata.org/sparql` (`P50`, `P648`)

Wykorzystywane właściwości: **P50** autor, **P577** data (rok), **P123** wydawca, **P212/P957** ISBN-13/10 (lookup ISBN jako 4. fallback po OL, BN i Google Books), **P648** Open Library ID (u dzieł kończy się na `W` → `/works/OL…`, u autorów na `A` → `/authors/OL…`), **P18** okładka z Commons (`https://commons.wikimedia.org/wiki/Special:FilePath/<plik>?width=300`).

Zastosowania:
- `POST /api/books/wikidata-search` — wyszukiwanie po tytule w UI (obok Google Books); wybór wyniku może **ustawić `author_key`/`work_key`** (przez P648), więc książka trafia do wykrywania braków/nowych wydań (Google tego nie daje),
- `POST /api/books/wikidata-covers` — okładki z Commons w modalu okładek,
- `resolve-author` i backfill w `refresh` — fallback, gdy OL nie znajdzie autora (P648),
- `getBookByISBN` — 4. fallback lookupu ISBN (po OL, BN i Google Books),
- `getAuthorLatinName` — transkrypcja łacińska autora z cyrylicą (pl → en → GOST),
- `getMissingBooks` — dociąga dzieła autora z Wikidaty (SPARQL `P50`), dedup po `work_key`; rekord ma `source: 'wikidata'`. Uwaga: P648 w Wikidacie jest rzadkie, więc supplement jest zwykle mały.

## GitHub / eksport — zasady

- **Nigdy nie commitować** `server/.env`, `node_modules/`, `dist/` (pokryte `.gitignore`). Sekrety tylko w lokalnym `.env` (szablon: `.env.example`).
- Repozytorium ma być samo-dokumentujące: `README.md` opisuje setup, uruchamianie i wdrożenie.
- Eksport: utwórz repo, `git add . && git commit`, upewnij się że `git status` nie pokazuje `.env` ani `node_modules`.
- Do ponownego uruchomienia po `git clone`: `npm run install:all` → utwórz `server/.env` → `npm run db:migrate` → `npm run dev` (lokalnie).

## Środowisko deweloperskie (informacje lokalne)

- Host: Linux, Node 20.20.2 (brak Pythona, brak lokalnego klienta MariaDB).
- Uruchamianie serwera API w tle na czas pracy: `setsid nohup node src/app.js > /tmp/opencode/server.log 2>&1 < /dev/null &` (uwaga: sesje w MemoryStore giną po restarcie — trzeba się zalogować ponownie).
- Nie używaj `pkill -f "app.js"` — wzorzec łapie też powłokę; kasuj PID przez `pgrep -f "app\.js" | grep -v $$` lub kill po PID.
