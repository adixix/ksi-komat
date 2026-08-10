# Ksiazkomat 📚

Domowy spis inwentaryzacyjny biblioteczki — PWA (działa w przeglądarce na komputerze, Androidzie i iOS).

- Dodawanie książek po **ISBN** (dane z Open Library), **ręcznie** lub przez **skaner kodu kreskowego** (kamera telefonu)
- Wieloosobowe konta (rejestracja/logowanie), każdy ma własną półkę
- **Wykrywanie**: brakujące książki autorów z Twojej półki oraz nowsze wydania posiadanych tytułów
- Powiadomienia w aplikacji + kanał **RSS** (fundament pod e-mail)
- Instalowalne jako PWA (ekran główny telefonu)

## Stack

- **Backend:** Node.js 20, Express, `mysql2` (MariaDB), `express-session`, `bcryptjs`
- **Frontend:** React 18 + Vite, `html5-qrcode` (skaner), PWA (manifest + service worker)
- **Baza:** MariaDB (zdalna, `utf8mb4` / `utf8mb4_unicode_ci`)
- **Dane książek:** [Open Library API](https://openlibrary.org/developers/api) (bez klucza)

## Wymagania

- Node.js ≥ 20
- Dostęp do bazy MariaDB (zdalny serwer `przyba.pl`, baza `ksiazkomat`)
- Do skanowania kamerą na telefonie: HTTPS (lub `localhost`)

## Uruchomienie lokalnie

```bash
npm install          # instalacja zależności w /root
npm run install:all  # instalacja w server/ i client/

# 1. konfiguracja bazy
cp server/.env.example server/.env
# wpisz dane MariaDB + SESSION_SECRET w server/.env

# 2. migracje schematu (tworzy tabele w MariaDB)
npm run db:migrate

# 3. dewelopersko (API :3001 + Vite :5173 z proxy)
npm run dev

# albo produkcyjnie (serwer serwuje zbudowany frontend)
npm run build
npm run start
```

Po uruchomieniu otwórz http://localhost:5173 (dev) lub http://localhost:3001 (prod) i zarejestruj konto.

## Testy

Do ręcznego testowania przepływów API:

```bash
curl -c /tmp/j -X POST localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"x@example.com","password":"haslo123"}'
curl -b /tmp/j localhost:3001/api/books
```

## Wdrożenie produkcyjne (skanowanie z telefonów)

Skaner i logowanie wymagają HTTPS. Zalecany układ:

- Reverse proxy (np. nginx/caddy) na `przyba.pl` z certyfikatem Let's Encrypt → `localhost:3001`
- `NODE_ENV=production` + `SESSION_SECRET` w środowisku
- Server ma `trust proxy = 1` i cookie sesji w trybie `secure: 'auto'` (HTTPS → ciasteczko Secure)
- Kanał RSS: `https://twoja-domena/feed.rss?token=<FEED_TOKEN>`

## Struktura

```
server/            # API Express
  migrations/      # pliki SQL uruchamiane przez npm run db:migrate
  src/
    app.js         # bootstrap, sesje, CORS, statyki
    db.js          # pool mysql2
    migrate.js     # runner migracji
    ol.js          # klient Open Library + cache
    routes/
      auth.js      # rejestracja / logowanie / logout / me
      books.js     # CRUD półki + lookup ISBN
      discovery.js # brakujące książki, nowe wydania, powiadomienia
      feed.js      # /feed.rss (token)
client/            # React + Vite PWA
  src/             # App, Login, Shelf, AddBook, BookForm (skaner), Notifications
  public/          # manifest, ikona, service worker
```

## Bezpieczeństwo

- Hasła hashowane `bcrypt`
- Sesje w ciasteczku `HttpOnly` + `SameSite=Lax`
- `server/.env` zawiera hasło do bazy i jest w `.gitignore` — **nigdy nie wrzucaj go na GitHub**
- RSS chroniony tokenem z `.env`
