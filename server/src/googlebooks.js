import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const BASE = 'https://www.googleapis.com/books/v1';
const TTL_MS = 60 * 60 * 24 * 14 * 1000; // 14 dni (jak ISBN w OL)

export function googleBooksEnabled() {
  return !!API_KEY;
}

async function withCache(key, loader) {
  const [rows] = await pool.query('SELECT data, fetched_at FROM ol_cache WHERE `key` = ?', [key]);
  if (rows.length) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age < TTL_MS) return JSON.parse(rows[0].data);
  }
  const data = await loader();
  // Nie cache'ujemy wartości fałszywych (null) — chwilowy błąd API nie może
  // zablokować poprawnego wyniku na 14 dni.
  if (data) {
    await pool.query(
      'INSERT INTO ol_cache (`key`, data, fetched_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE data = VALUES(data), fetched_at = NOW()',
      [key, JSON.stringify(data)]
    );
  }
  return data;
}

const parseYear = (value) => {
  if (!value) return null;
  const m = String(value).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

// Fallback używany tylko, gdy Open Library nie zna ISBN.
// Zwraca znormalizowany rekord (bez kluczy OL) albo null.
export async function getBookFromGoogleByISBN(isbn) {
  if (!API_KEY) return null;
  const key = `google-isbn:${isbn}`;
  return withCache(key, async () => {
    const url = `${BASE}/volumes?q=isbn:${encodeURIComponent(isbn)}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const item = json.items && json.items.find((it) => it.kind === 'books#volume');
    if (!item) return null;
    const vi = item.volumeInfo || {};
    const hasIsbn = (vi.industryIdentifiers || []).some(
      (x) => x.identifier && x.identifier.replace(/[^0-9Xx]/g, '').toUpperCase() === isbn
    );
    if (!hasIsbn) return null;
    return {
      isbn,
      title: vi.title || null,
      author: (vi.authors || []).join(', ') || null,
      author_key: null,
      work_key: null,
      publisher: vi.publisher || null,
      publish_year: parseYear(vi.publishedDate),
      cover_url: (vi.imageLinks && (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail)) || null,
    };
  });
}
