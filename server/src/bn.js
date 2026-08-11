import pool from './db.js';

const BASE = 'https://data.bn.org.pl/api/institutions';
const USER_AGENT = 'ksiazkomat/0.1 (domowy spis biblioteczki; +https://przyba.pl)';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni (jak works/editions w OL)

async function withCache(key, loader) {
  const [rows] = await pool.query('SELECT data, fetched_at FROM ol_cache WHERE `key` = ?', [key]);
  if (rows.length) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age < TTL_MS) return JSON.parse(rows[0].data);
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

const parseYear = (value) => {
  if (!value) return null;
  const m = String(value).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

const marcField = (marc, tag) => {
  if (!marc || !Array.isArray(marc.fields)) return null;
  for (const f of marc.fields) if (f && f[tag]) return f[tag];
  return null;
};const subText = (field, code) => {
  for (const s of field?.subfields || []) if (s && s[code] !== undefined) return String(s[code]);
  return '';
};

// 245a+245b: tytuł z podtytułem, usuwamy końcowe „ / : ,"
// 100a: autor, 100d: daty (obcinamy), 246a+b: tytuł oryginału, 260b: wydawca, 260c: rok
function parseRecord(b) {
  if (!b) return null;
  const marc = b.marc;
  const f245 = marcField(marc, '245');
  const f100 = marcField(marc, '100');
  const f246 = marcField(marc, '246');
  const f260 = marcField(marc, '260');

  const titleA = subText(f245, 'a');
  const titleB = subText(f245, 'b');
  const title = `${titleA} ${titleB}`
    .replace(/[\/,:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const authorDate = subText(f100, 'd');
  let author = subText(f100, 'a');
  if (authorDate && author.includes(authorDate)) author = author.replace(authorDate, '').trim();

  const origA = subText(f246, 'a');
  const origB = subText(f246, 'b');
  const originalTitle = `${origA} ${origB}`
    .replace(/[\/,:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const publisher = subText(f260, 'b').replace(/[,\s]+$/g, '').trim();
  const publishYear = parseYear(b.publicationYear || subText(f260, 'c'));

  return {
    isbn: String(b.isbnIssn || '').replace(/[^0-9Xx]/g, '').toUpperCase() || null,
    title: title || null,
    author: author || null,
    originalTitle: originalTitle || null,
    publisher: publisher || null,
    publishYear,
  };
}

// Fallback lookupu ISBN — Biblioteka Narodowa (data.bn.org.pl). Dobre pokrycie
// niszowych polskich wydań, czyste metadane PL i tytuł oryginału (246), ale
// bez okładek i bez kluczy OL — resztę dokleja enrichBN w ol.js.
// Zwraca znormalizowany rekord albo null.
export async function getBookByISBN(isbn) {
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (!clean) return null;
  const key = `bn-isbn:${clean}`;
  return withCache(key, async () => {
    const url = `${BASE}/bibs.json?isbnIssn=${encodeURIComponent(clean)}&limit=2`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Biblioteka Narodowa ${res.status}`);
    const json = await res.json();
    if (!json.bibs || !json.bibs.length) return null;
    return parseRecord(json.bibs[0]);
  });
}
