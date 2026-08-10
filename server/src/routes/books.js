import { Router } from 'express';
import pool from '../db.js';
import { getBookByISBN, normalizeISBN, resolveAuthorByName, searchCovers } from '../ol.js';
import { getBookFromGoogleByISBN, googleBooksEnabled, searchGoogleBooks } from '../googlebooks.js';
import {
  resolveAuthorByName as resolveAuthorByNameWikidata,
  searchBooks as searchBooksWikidata,
  searchCovers as searchCoversWikidata,
  getBookByISBN as getBookFromWikidataByISBN,
} from '../wikidata.js';

const router = Router();

const BOOK_COLUMNS = [
  'id', 'user_id', 'isbn', 'title', 'author', 'author_key', 'work_key',
  'publisher', 'publish_year', 'cover_url', 'edition', 'notes', 'status', 'created_at',
];

function parseYear(value) {
  if (!value) return null;
  const m = String(value).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function rowToBook(row) {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    authorKey: row.author_key,
    workKey: row.work_key,
    publisher: row.publisher,
    publishYear: row.publish_year,
    coverUrl: row.cover_url,
    edition: row.edition,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function getOwnedKeys(conn, userId) {
  const [rows] = await conn.query(
    'SELECT work_key FROM books WHERE user_id = ? AND work_key IS NOT NULL',
    [userId]
  );
  return new Set(rows.map((r) => r.work_key));
}

const SORT_COLUMNS = {
  author: 'author',
  title: 'title',
  year: 'publish_year',
  created: 'created_at',
  status: 'status',
};

router.get('/', async (req, res) => {
  const { q = '', author = '', status = '' } = req.query;
  const sort = SORT_COLUMNS[req.query.sort] || 'author';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const params = [req.session.userId];
  const where = ['user_id = ?'];
  if (q) {
    where.push('(title LIKE ? OR author LIKE ? OR isbn LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (author) {
    where.push('author = ?');
    params.push(author);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const orderBy =
    sort === 'publish_year'
      ? `(publish_year IS NULL) ASC, publish_year ${dir}, title ASC`
      : `${sort} ${dir}, title ASC`;
  const [rows] = await pool.query(
    `SELECT ${BOOK_COLUMNS.join(', ')} FROM books WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
    params
  );
  res.json(rows.map(rowToBook));
});

router.get('/authors', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT author, COUNT(*) AS count FROM books WHERE user_id = ? GROUP BY author ORDER BY author`,
    [req.session.userId]
  );
  res.json(rows);
});

router.post('/cover-search', async (req, res) => {
  const title = (req.body?.title || '').trim();
  const author = (req.body?.author || '').trim();
  if (!title && !author) return res.status(400).json({ error: 'Podaj tytuł lub autora.' });
  try {
    res.json(await searchCovers({ title, author }));
  } catch (err) {
    res.status(502).json({ error: `Open Library nie odpowiada: ${err.message}` });
  }
});

router.post('/gb-search', async (req, res) => {
  const q = (req.body?.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Podaj tytuł lub autora.' });
  try {
    const list = await searchGoogleBooks(q);
    if (!list) return res.status(502).json({ error: 'Google Books nie odpowiada.' });
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: `Google Books nie odpowiada: ${err.message}` });
  }
});

router.post('/wikidata-search', async (req, res) => {
  const { title = '', author = '' } = req.body || {};
  if (!String(title).trim() && !String(author).trim()) {
    return res.status(400).json({ error: 'Podaj tytuł lub autora.' });
  }
  try {
    const list = await searchBooksWikidata({ title, author });
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: `Wikidata nie odpowiada: ${err.message}` });
  }
});

router.post('/wikidata-covers', async (req, res) => {
  const { title = '', author = '' } = req.body || {};
  try {
    const list = await searchCoversWikidata({ title, author });
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: `Wikidata nie odpowiada: ${err.message}` });
  }
});

router.post('/resolve-author', async (req, res) => {
  const author = (req.body?.author || '').trim();
  if (!author) return res.status(400).json({ error: 'Podaj nazwisko autora.' });
  try {
    let r = null;
    try {
      r = await resolveAuthorByName(author);
    } catch {
      // próbujemy dalej w Wikidacie
    }
    if (!r) r = await resolveAuthorByNameWikidata(author);
    res.json(r || { key: null, name: null });
  } catch (err) {
    res.status(502).json({ error: `Open Library nie odpowiada: ${err.message}` });
  }
});

router.post('/lookup', async (req, res) => {
  const isbn = normalizeISBN(req.body?.isbn);
  if (!isbn) return res.status(400).json({ error: 'Nieprawidłowy ISBN.' });
  try {
    const entry = await getBookByISBN(isbn);
    if (!entry) {
      const gb = await getBookFromGoogleByISBN(isbn);
      if (gb) {
        return res.json({
          isbn: gb.isbn,
          title: gb.title,
          author: gb.author || 'Nieznany autor',
          authorKey: null,
          workKey: null,
          publisher: gb.publisher,
          publishYear: gb.publish_year,
          coverUrl: gb.cover_url,
          source: 'google',
        });
      }
      const wd = await getBookFromWikidataByISBN(isbn);
      if (wd) {
        return res.json({ ...wd, source: 'wikidata' });
      }
      return res.status(404).json({ error: 'Nie znaleziono książki o tym ISBN (Open Library / Google Books / Wikidata).' });
    }
    res.json({
      isbn,
      title: entry.title,
      author: entry.resolved_author_name || entry.authors?.[0]?.name || 'Nieznany autor',
      authorKey: entry.author_key,
      workKey: entry.work_key,
      publisher: entry.publishers?.[0]?.name || null,
      publishYear: parseYear(entry.publish_date),
      coverUrl: entry.cover?.medium || entry.cover?.large || null,
    });
  } catch (err) {
    res.status(502).json({ error: `Open Library nie odpowiada: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  const userId = req.session.userId;
  const body = req.body || {};

  let record = {
    isbn: normalizeISBN(body.isbn) || null,
    title: (body.title || '').trim(),
    author: (body.author || '').trim(),
    authorKey: body.authorKey || null,
    workKey: body.workKey || null,
    publisher: body.publisher || null,
    publishYear: body.publishYear || null,
    coverUrl: body.coverUrl || null,
    edition: body.edition || null,
    notes: body.notes || null,
    status: ['owned', 'wanted', 'loaned', 'read'].includes(body.status) ? body.status : 'owned',
  };

  if (record.isbn && !record.title) {
    let entry;
    try {
      entry = await getBookByISBN(record.isbn);
    } catch (err) {
      return res.status(502).json({ error: `Open Library nie odpowiada: ${err.message}` });
    }
    if (!entry) {
      const gb = await getBookFromGoogleByISBN(record.isbn);
      if (gb) {
        record = {
          ...record,
          title: gb.title,
          author: gb.author || 'Nieznany autor',
          authorKey: null,
          workKey: null,
          publisher: gb.publisher,
          publishYear: gb.publish_year,
          coverUrl: gb.cover_url,
        };
      } else {
        const wd = await getBookFromWikidataByISBN(record.isbn);
        if (!wd) {
          return res.status(404).json({ error: 'Nie znaleziono książki o tym ISBN (Open Library / Google Books / Wikidata).' });
        }
        record = {
          ...record,
          title: wd.title,
          author: wd.author,
          authorKey: wd.authorKey,
          workKey: wd.workKey,
          publisher: wd.publisher,
          publishYear: wd.publishYear,
          coverUrl: wd.coverUrl,
        };
      }
    } else {
      record = {
        ...record,
        title: entry.title,
        author: entry.resolved_author_name || entry.authors?.[0]?.name || 'Nieznany autor',
        authorKey: entry.author_key || record.authorKey,
        workKey: entry.work_key || record.workKey,
        publisher: entry.publishers?.[0]?.name || null,
        publishYear: parseYear(entry.publish_date),
        coverUrl: entry.cover?.medium || entry.cover?.large || null,
      };
    }
  }

  if (!record.title) return res.status(400).json({ error: 'Tytuł jest wymagany.' });
  if (!record.author) return res.status(400).json({ error: 'Autor jest wymagany.' });

  if (!record.authorKey && record.author !== 'Nieznany autor') {
    try {
      const resolved = await resolveAuthorByName(record.author);
      if (resolved) {
        record.authorKey = resolved.key;
        record.author = resolved.name;
      }
    } catch {
      // brak dopasowania autora nie blokuje dodania książki
    }
  }

  if (record.isbn) {
    const [existing] = await pool.query(
      'SELECT id FROM books WHERE user_id = ? AND isbn = ?',
      [userId, record.isbn]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Książka o tym ISBN jest już na półce.' });
    }
  }

  const [result] = await pool.query(
    `INSERT INTO books (user_id, isbn, title, author, author_key, work_key, publisher, publish_year, cover_url, edition, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, record.isbn, record.title, record.author, record.authorKey, record.workKey,
      record.publisher, record.publishYear, record.coverUrl, record.edition, record.notes, record.status,
    ]
  );

  const [rows] = await pool.query(
    `SELECT ${BOOK_COLUMNS.join(', ')} FROM books WHERE id = ? AND user_id = ?`,
    [result.insertId, userId]
  );
  res.status(201).json(rowToBook(rows[0]));
});

router.put('/:id', async (req, res) => {
  const userId = req.session.userId;
  const body = req.body || {};
  const [existing] = await pool.query('SELECT id FROM books WHERE id = ? AND user_id = ?', [
    req.params.id,
    userId,
  ]);
  if (!existing.length) return res.status(404).json({ error: 'Książka nie istnieje.' });

  const fields = ['title', 'author', 'publisher', 'edition', 'notes', 'status'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (f in body) {
      updates.push(`${f} = ?`);
      params.push(f === 'status' && !['owned', 'wanted', 'loaned', 'read'].includes(body[f]) ? 'owned' : body[f]);
    }
  }
  if ('isbn' in body) {
    const isbn = normalizeISBN(body.isbn);
    updates.push('isbn = ?');
    params.push(isbn);
  }
  if ('publishYear' in body) {
    updates.push('publish_year = ?');
    params.push(body.publishYear || null);
  }
  if ('coverUrl' in body) {
    updates.push('cover_url = ?');
    params.push(body.coverUrl || null);
  }
  if ('workKey' in body) {
    updates.push('work_key = ?');
    params.push(body.workKey || null);
  }
  if ('author' in body || 'authorKey' in body) {
    if ('authorKey' in body) {
      updates.push('author_key = ?');
      params.push(body.authorKey || null);
    } else if ('author' in body) {
      let resolved = null;
      if (body.author && body.author !== 'Nieznany autor') {
        try {
          const r = await resolveAuthorByName(body.author);
          if (r) resolved = r.key;
        } catch {
          resolved = null;
        }
      }
      updates.push('author_key = ?');
      params.push(resolved);
    }
  }
  if (updates.length) {
    params.push(req.params.id, userId);
    await pool.query(`UPDATE books SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);
  }
  const [rows] = await pool.query(
    `SELECT ${BOOK_COLUMNS.join(', ')} FROM books WHERE id = ? AND user_id = ?`,
    [req.params.id, userId]
  );
  res.json(rowToBook(rows[0]));
});

router.delete('/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM books WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.session.userId,
  ]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Książka nie istnieje.' });
  res.json({ ok: true });
});

export default router;
export { getOwnedKeys, parseYear };
