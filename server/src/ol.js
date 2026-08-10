import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const BASE = process.env.OPENLIBRARY_BASE || 'https://openlibrary.org';
const USER_AGENT = 'ksiazkomat/0.1 (domowy spis biblioteczki; +https://przyba.pl)';
const TTL_MS = {
  isbn: 60 * 60 * 24 * 14 * 1000, // 14 dni
  works: 7 * 24 * 60 * 60 * 1000, // 7 dni
  editions: 7 * 24 * 60 * 60 * 1000,
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Open Library ${res.status} for ${url}`);
  return res.json();
}

async function withCache(key, kind, loader) {
  const [rows] = await pool.query('SELECT data, fetched_at FROM ol_cache WHERE `key` = ?', [key]);
  if (rows.length) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age < (TTL_MS[kind] || TTL_MS.works)) {
      return JSON.parse(rows[0].data);
    }
  }
  const data = await loader();
  if (data) {
    await pool.query(
      'INSERT INTO ol_cache (`key`, data, fetched_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE data = VALUES(data), fetched_at = NOW()',
      [key, JSON.stringify(data)]
    );
  }
  return data;
}

export function normalizeISBN(isbn) {
  if (!isbn) return null;
  const clean = String(isbn).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (clean.length !== 10 && clean.length !== 13) return null;
  return clean;
}

const parseYear = (value) => {
  if (!value) return null;
  const m = String(value).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

async function searchByTitle(title) {
  const cacheKey = `title-search:${normalizeName(title)}`;
  return withCache(cacheKey, 'works', async () => {
    const url = `${BASE}/search.json?q=${encodeURIComponent(
      `title:${title}`
    )}&fields=key,title,author_name,author_key,isbn,first_publish_year&limit=10`;
    const json = await fetchJSON(url);
    return json.docs || [];
  });
}

// Gdy rekord ISBN nie ma autora, szukamy go po tytule (OL ma czasem duplikaty dzieł,
// z czego jeden ma autora). Dopasowanie: identyczny znormalizowany tytuł, najpierw po ISBN,
// potem po roku, potem pierwszy trafiony.
async function findAuthorByTitle(entry, isbn) {
  const title = entry?.title;
  if (!title) return null;
  const year = parseYear(entry.publish_date);
  const docs = await searchByTitle(title);
  const want = normalizeName(title);
  const candidates = (docs || []).filter(
    (d) => normalizeName(d.title) === want && d.author_name && d.author_name.length
  );
  if (!candidates.length) return null;
  let match = candidates.find((d) => (d.isbn || []).includes(isbn));
  if (!match && year) match = candidates.find((d) => d.first_publish_year === year);
  if (!match) match = candidates[0];
  const rawKey = match.author_key && match.author_key[0];
  return {
    key: rawKey && !rawKey.startsWith('/authors/') ? `/authors/${rawKey}` : rawKey,
    name: match.author_name[0],
  };
}

async function enrichWithKeys(entry, isbn) {
  if (!entry) return null;
  const editionKey = entry.key;
  let authorKey = null;
  let workKey = null;
  let resolvedAuthorName = null;
  if (editionKey) {
    try {
      const ed = await withCache(`edition:${editionKey}`, 'works', async () =>
        fetchJSON(`${BASE}${editionKey}.json`)
      );
      if (ed.works && ed.works[0]) workKey = ed.works[0].key;
      if (ed.authors && ed.authors[0]) authorKey = ed.authors[0].key;
      if (!workKey && ed.works && ed.works[0] && ed.works[0].key) workKey = ed.works[0].key;
    } catch {
      // brak kluczy nie jest blędem krytycznym
    }
  }
  if (!authorKey && entry.authors && entry.authors[0]) {
    const m = entry.authors[0].url.match(/authors\/([^/]+)/);
    if (m) authorKey = m[1];
  }
  if (!authorKey && entry.title) {
    try {
      const found = await findAuthorByTitle(entry, isbn);
      if (found) {
        authorKey = found.key;
        resolvedAuthorName = found.name;
      }
    } catch {
      // wyszukiwanie po tytule to tylko fallback
    }
  }
  return { ...entry, author_key: authorKey, work_key: workKey, resolved_author_name: resolvedAuthorName };
}

export async function getBookByISBN(isbn) {
  const key = `isbn:${isbn}`;
  return withCache(key, 'isbn', async () => {
    const json = await fetchJSON(`${BASE}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const entry = json[`ISBN:${isbn}`];
    return enrichWithKeys(entry, isbn);
  });
}

const stripPrefix = (key, prefix) => String(key || '').replace(prefix, '');

export async function getAuthorWorks(authorKey) {
  const key = `author-works:${stripPrefix(authorKey, '/authors/')}`;
  return withCache(key, 'works', async () => {
    const json = await fetchJSON(
      `${BASE}/authors/${encodeURIComponent(stripPrefix(authorKey, '/authors/'))}/works.json?limit=500`
    );
    return json;
  });
}

// works.json nie zawiera okładek (cover_i) — pobieramy je osobno z search API
// po author_key, dopasowując po kluczu dzieła.
export async function getAuthorCovers(authorKey) {
  const key = `author-covers:${stripPrefix(authorKey, '/authors/')}`;
  return withCache(key, 'works', async () => {
    const json = await fetchJSON(
      `${BASE}/search.json?author_key=${encodeURIComponent(
        stripPrefix(authorKey, '/authors/')
      )}&fields=key,cover_i&limit=500`
    );
    const map = {};
    for (const d of json.docs || []) if (d.cover_i) map[d.key] = d.cover_i;
    return map;
  });
}

export async function getWorkEditions(workKey) {
  const key = `work-editions:${stripPrefix(workKey, '/works/')}`;
  return withCache(key, 'editions', async () => {
    const json = await fetchJSON(
      `${BASE}/works/${encodeURIComponent(stripPrefix(workKey, '/works/'))}/editions.json?limit=200`
    );
    return json;
  });
}

export async function getWork(workKey) {
  const key = `work:${stripPrefix(workKey, '/works/')}`;
  return withCache(key, 'works', async () => {
    const json = await fetchJSON(`${BASE}/works/${encodeURIComponent(stripPrefix(workKey, '/works/'))}.json`);
    return json;
  });
}

const normalizeName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const matchAuthor = (given, names) => {
  if (!given) return true;
  const want = normalizeName(given).replace(/\./g, '');
  return (names || []).some((n) => {
    const have = normalizeName(n).replace(/\./g, '');
    return have === want || have.includes(want) || want.includes(have);
  });
};

// Szukanie okładek w OL (do wyboru przez użytkownika, gdy lookup nie dał okładki).
// Kolejność: wyniki po autorze (dokładne), potem po tytule (odfiltrowane po autorze).
export async function searchCovers({ title, author } = {}) {
  const results = [];
  const seen = new Set();
  const add = (d) => {
    if (!d || !d.cover_i || !d.key || seen.has(d.key)) return;
    seen.add(d.key);
    results.push({
      workKey: d.key,
      title: d.title,
      year: d.first_publish_year || null,
      coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
    });
  };

  if (author) {
    const docs = await withCache(`cover-search-author:${normalizeName(author)}`, 'works', async () => {
      const json = await fetchJSON(
        `${BASE}/search.json?author=${encodeURIComponent(author)}&fields=key,title,author_name,first_publish_year,cover_i&limit=30`
      );
      return json.docs || [];
    });
    for (const d of docs) if (matchAuthor(author, d.author_name)) add(d);
  }

  if (title) {
    const docs = await withCache(`cover-search-title:${normalizeName(title)}`, 'works', async () => {
      const json = await fetchJSON(
        `${BASE}/search.json?q=${encodeURIComponent(`title:${title}`)}&fields=key,title,author_name,first_publish_year,cover_i&limit=20`
      );
      return json.docs || [];
    });
    for (const d of docs) if (matchAuthor(author, d.author_name)) add(d);
  }

  return results.slice(0, 12);
}

export async function resolveAuthorByName(name) {
  const cacheKey = `author-search:${normalizeName(name)}`;
  return withCache(cacheKey, 'works', async () => {
    const json = await fetchJSON(
      `${BASE}/search/authors.json?q=${encodeURIComponent(name)}&limit=5`
    );
    const want = normalizeName(name);
    for (const d of json.docs || []) {
      const have = normalizeName(d.name);
      if (want && (want === have || have.includes(want) || want.includes(have))) {
        return { key: d.key.startsWith('/authors/') ? d.key : `/authors/${d.key}`, name: d.name };
      }
    }
    return null;
  });
}
