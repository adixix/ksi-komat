import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'ksiazkomat/0.1 (domowy spis biblioteczki; +https://przyba.pl)';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni (jak works/editions w OL)

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status} for ${url}`);
  return res.json();
}

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

const normalizeName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const timeYear = (t) => {
  const m = String(t).match(/[+-]?(\d{4})/);
  return m ? Number(m[1]) : null;
};

function plLabel(ent) {
  const labels = ent?.labels || {};
  return labels.pl?.value || labels.en?.value || labels[Object.keys(labels)[0]]?.value || null;
}

function claimValues(claims, prop, kind) {
  const list = claims?.[prop] || [];
  const out = [];
  for (const st of list) {
    const ms = st?.mainsnak;
    if (ms?.snaktype !== 'value') continue;
    const v = ms.datavalue?.value;
    if (!v) continue;
    if (kind === 'id' && typeof v === 'object' && v.id) out.push(v.id);
    else if (kind === 'string' && typeof v === 'string') out.push(v);
    else if (kind === 'time' && typeof v === 'object' && v.time) out.push(v.time);
  }
  return out;
}

const isHuman = (claims) => claimValues(claims, 'P31', 'id').includes('Q5');

const isWork = (claims) => claimValues(claims, 'P50', 'id').length > 0;

function commonsUrl(file) {
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=300`;
}

async function getEntities(ids) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return {};
  const url = `${API}?action=wbgetentities&ids=${encodeURIComponent(uniq.join('|'))}&props=claims|labels&languages=pl|en&format=json`;
  const json = await fetchJSON(url);
  return json?.entities || {};
}

function entityToBook(ent) {
  const claims = ent?.claims || {};
  const ol = claimValues(claims, 'P648', 'string')[0] || null;
  const isbn13 = claimValues(claims, 'P212', 'string')[0] || null;
  const isbn10 = claimValues(claims, 'P957', 'string')[0] || null;
  const years = claimValues(claims, 'P577', 'time').map(timeYear).filter(Boolean);
  return {
    id: ent.id,
    title: plLabel(ent) || ent.id,
    authorQid: claimValues(claims, 'P50', 'id')[0] || null,
    publishYear: years[0] || null,
    publisherQid: claimValues(claims, 'P123', 'id')[0] || null,
    workKey: ol && /W$/.test(ol) ? `/works/${ol}` : null,
    isbn: isbn13 || isbn10 || null,
    coverUrl: commonsUrl(claimValues(claims, 'P18', 'string')[0]),
  };
}

// Wyszukiwanie po tytule (Wikidata szuka po frazie — najlepiej po tytule,
// potem filtrujemy po autorze przez claims). Zwraca listę lub [].
export async function searchBooks({ title, author } = {}) {
  const t = (title || '').trim();
  const a = (author || '').trim();
  if (!t && !a) return [];
  const cacheKey = `wd-search:${normalizeName(t)}|${normalizeName(a)}`;
  return withCache(cacheKey, async () => {
    const q = t || a;
    const url = `${API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=pl&format=json&type=item&limit=8`;
    const sres = await fetchJSON(url);
    const ids = (sres.search || []).map((s) => s.id);
    if (!ids.length) return [];
    const entities = await getEntities(ids);
    const items = Object.values(entities)
      .filter((ent) => !isHuman(ent.claims || {}))
      .map((ent) => entityToBook(ent));

    const authorQids = [...new Set(items.map((i) => i.authorQid).filter(Boolean))];
    const pubQids = [...new Set(items.map((i) => i.publisherQid).filter(Boolean))];
    const extra = await getEntities([...authorQids, ...pubQids]);
    for (const item of items) {
      const ae = item.authorQid ? extra[item.authorQid] : null;
      item.author = ae ? plLabel(ae) : null;
      const aol = ae ? claimValues(ae.claims || {}, 'P648', 'string')[0] : null;
      item.authorKey = aol && /A$/.test(aol) ? `/authors/${aol}` : null;
      const pe = item.publisherQid ? extra[item.publisherQid] : null;
      item.publisher = pe ? plLabel(pe) : null;
    }

    const want = normalizeName(a);
    const filtered = a
      ? items.filter(
          (it) =>
            it.author &&
            (normalizeName(it.author).includes(want) || want.includes(normalizeName(it.author)))
        )
      : items;

    return filtered.map(({ authorQid, publisherQid, ...rest }) => rest);
  });
}

// Autor po nazwisku → klucz Open Library (przez P648) lub null.
export async function resolveAuthorByName(name) {
  const want = normalizeName(name);
  if (!want) return null;
  const cacheKey = `wd-author:${want}`;
  return withCache(cacheKey, async () => {
    const url = `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=pl&format=json&type=item&limit=10`;
    const sres = await fetchJSON(url);
    const ids = (sres.search || []).map((s) => s.id);
    if (!ids.length) return null;
    const entities = await getEntities(ids);
    for (const ent of Object.values(entities)) {
      const claims = ent.claims || {};
      if (!isHuman(claims)) continue;
      const have = normalizeName(plLabel(ent) || '');
      if (want !== have && !have.includes(want) && !want.includes(have)) continue;
      const ol = claimValues(claims, 'P648', 'string')[0] || null;
      if (ol && /A$/.test(ol)) return { key: `/authors/${ol}`, name: plLabel(ent) };
    }
    return null;
  });
}

async function sparql(query) {
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  const json = await res.json();
  return json?.results?.bindings || [];
}

const bind = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) out[k] = v?.value ?? null;
  return out;
};

// Dzieła autora wg QID; jeśli dzieło ma P648 (OL), zwracamy klucz OL.
export async function getAuthorWorks(qid) {
  const qidClean = String(qid || '').replace('http://www.wikidata.org/entity/', '');
  if (!/^Q\d+$/.test(qidClean)) return [];
  const cacheKey = `wd-works:${qidClean}`;
  return withCache(cacheKey, async () => {
    const query = `SELECT ?work ?workLabel ?workOL ?date WHERE {
  ?work wdt:P50 wd:${qidClean}.
  OPTIONAL { ?work wdt:P648 ?workOL. }
  OPTIONAL { ?work wdt:P577 ?date. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pl,en". }
}`;
    const rows = await sparql(query);
    return rows.map((r) => {
      const b = bind(r);
      const ol = b.workOL && /W$/.test(b.workOL) ? b.workOL : null;
      return {
        workKey: ol ? `/works/${ol}` : null,
        title: b.workLabel || null,
        firstPublishYear: timeYear(b.date),
      };
    });
  });
}

// Odwrotne mapowanie: klucz OL autora → QID (do dociągania dzieł z Wikidaty).
export async function olAuthorToQid(olKey) {
  const key = String(olKey || '').replace(/^\/authors\//, '');
  if (!key) return null;
  const cacheKey = `wd-ol-author:${key}`;
  return withCache(cacheKey, async () => {
    const query = `SELECT ?item WHERE { ?item wdt:P648 "${key}". } LIMIT 1`;
    const rows = await sparql(query);
    if (!rows.length) return null;
    const uri = bind(rows[0]).item || '';
    return uri.replace('http://www.wikidata.org/entity/', '');
  });
}

// Okładki z Commons (P18) — do modala wyboru okładki.
export async function searchCovers({ title, author } = {}) {
  const items = await searchBooks({ title, author });
  return items
    .filter((it) => it.coverUrl)
    .map((it) => ({ id: it.id, title: it.title, year: it.publishYear, coverUrl: it.coverUrl }));
}
