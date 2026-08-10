import { Router } from 'express';
import pool from '../db.js';
import { getAuthorWorks, getWorkEditions, getWork, resolveAuthorByName } from '../ol.js';
import { getOwnedKeys, parseYear } from './books.js';

const router = Router();

const MAX_EDITIONS_PER_WORK = 5;

function coverFromId(id, size = 'M') {
  return id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null;
}

async function getMissingBooks(userId) {
  const [authorRows] = await pool.query(
    'SELECT DISTINCT author_key, author FROM books WHERE user_id = ? AND author_key IS NOT NULL',
    [userId]
  );
  const ownedWorkKeys = await getOwnedKeys(pool, userId);
  const [ownedIsbnsRows] = await pool.query(
    'SELECT DISTINCT isbn FROM books WHERE user_id = ? AND isbn IS NOT NULL',
    [userId]
  );
  const ownedIsbns = new Set(ownedIsbnsRows.map((r) => r.isbn));

  const missing = [];
  for (const { author_key, author } of authorRows) {
    let works;
    try {
      works = await getAuthorWorks(author_key);
    } catch {
      continue;
    }
    const entries = works.entries || [];
    for (const w of entries) {
      if (ownedWorkKeys.has(w.key)) continue;
      const isbn = w.isbn || (w.isbn_13 && w.isbn_13[0]);
      if (isbn && ownedIsbns.has(isbn)) continue;
      missing.push({
        authorKey: author_key,
        author,
        workKey: w.key,
        title: w.title,
        firstPublishYear: w.first_publish_year || null,
        coverUrl: coverFromId(w.cover_i),
      });
    }
  }
  missing.sort((a, b) => a.author.localeCompare(b.author) || (a.firstPublishYear || 0) - (b.firstPublishYear || 0));
  return missing;
}

async function getNewEditions(userId) {
  const [bookRows] = await pool.query(
    'SELECT id, isbn, title, author, work_key, publish_year FROM books WHERE user_id = ? AND work_key IS NOT NULL',
    [userId]
  );
  const [ownedIsbnsRows] = await pool.query(
    'SELECT DISTINCT isbn FROM books WHERE user_id = ? AND isbn IS NOT NULL',
    [userId]
  );
  const ownedIsbns = new Set(ownedIsbnsRows.map((r) => r.isbn));

  const byWork = new Map();
  for (const b of bookRows) {
    if (!byWork.has(b.work_key)) byWork.set(b.work_key, { books: [], workKey: b.work_key });
    byWork.get(b.work_key).books.push(b);
  }

  const results = [];
  for (const group of byWork.values()) {
    const ownedYears = group.books.map((b) => b.publish_year).filter(Boolean);
    const ownedIsbnSet = new Set(group.books.map((b) => b.isbn).filter(Boolean));
    const ownedEditionKeys = new Set(group.books.map((b) => b.isbn).filter(Boolean));

    let editions;
    try {
      editions = await getWorkEditions(group.workKey);
    } catch {
      continue;
    }
    const baseYear = ownedYears.length ? Math.max(...ownedYears) : new Date().getFullYear() - 3;

    const newer = (editions.entries || [])
      .map((e) => {
        const year = parseYear(e.publish_date);
        const isbn = e.isbn_13?.[0] || e.isbn_10?.[0] || null;
        return { ...e, year, isbn };
      })
      .filter((e) => e.year && e.year > baseYear && !ownedIsbnSet.has(e.isbn))
      .sort((a, b) => b.year - a.year)
      .slice(0, MAX_EDITIONS_PER_WORK);

    for (const e of newer) {
      const primary = group.books[0];
      results.push({
        workKey: group.workKey,
        ownedTitle: primary.title,
        ownedAuthor: primary.author,
        ownedYear: baseYear,
        editionKey: e.key,
        title: e.title || primary.title,
        isbn: e.isbn,
        publishYear: e.year,
        coverUrl: e.covers?.[0] ? coverFromId(e.covers[0]) : null,
      });
    }
  }
  results.sort((a, b) => (b.publishYear || 0) - (a.publishYear || 0));
  return results;
}

async function backfillAuthorKeys(userId) {
  const [rows] = await pool.query(
    `SELECT id, author FROM books
     WHERE user_id = ? AND author_key IS NULL AND author IS NOT NULL AND author != 'Nieznany autor'`,
    [userId]
  );
  let resolved = 0;
  for (const row of rows) {
    try {
      const r = await resolveAuthorByName(row.author);
      if (r) {
        await pool.query('UPDATE books SET author_key = ? WHERE id = ?', [r.key, row.id]);
        resolved++;
      }
    } catch {
      // ignoruj, ponowna próba przy następnym odświeżeniu
    }
  }
  return resolved;
}

router.get('/missing', async (req, res) => {
  try {
    res.json(await getMissingBooks(req.session.userId));
  } catch (err) {
    res.status(502).json({ error: `Błąd Open Library: ${err.message}` });
  }
});

router.get('/new-editions', async (req, res) => {
  try {
    res.json(await getNewEditions(req.session.userId));
  } catch (err) {
    res.status(502).json({ error: `Błąd Open Library: ${err.message}` });
  }
});

router.post('/refresh', async (req, res) => {
  const userId = req.session.userId;
  try {
    await pool.query('DELETE FROM notification_events WHERE user_id = ?', [userId]);

    const resolvedAuthors = await backfillAuthorKeys(userId);

    const missing = await getMissingBooks(userId);
    for (const m of missing) {
      await pool.query(
        'INSERT INTO notification_events (user_id, kind, payload) VALUES (?, ?, ?)',
        [userId, 'missing_book', JSON.stringify(m)]
      );
    }

    const editions = await getNewEditions(userId);
    for (const e of editions) {
      await pool.query(
        'INSERT INTO notification_events (user_id, kind, payload) VALUES (?, ?, ?)',
        [userId, 'new_edition', JSON.stringify(e)]
      );
    }

    res.json({ ok: true, missing: missing.length, newEditions: editions.length, resolvedAuthors });
  } catch (err) {
    res.status(502).json({ error: `Błąd Open Library: ${err.message}` });
  }
});

router.get('/notifications', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, book_id, kind, payload, created_at, seen
     FROM notification_events WHERE user_id = ? ORDER BY seen ASC, created_at DESC LIMIT 500`,
    [req.session.userId]
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      kind: r.kind,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      createdAt: r.created_at,
      seen: !!r.seen,
    }))
  );
});

router.post('/notifications/:id/seen', async (req, res) => {
  const [result] = await pool.query(
    'UPDATE notification_events SET seen = 1 WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]
  );
  res.json({ ok: !!result.affectedRows });
});

export default router;
export { getMissingBooks, getNewEditions };
