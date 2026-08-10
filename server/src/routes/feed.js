import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function kindLabel(kind) {
  return kind === 'missing_book' ? 'Brakująca książka' : 'Nowe wydanie';
}

router.get('/feed.rss', async (req, res) => {
  const token = process.env.FEED_TOKEN || process.env.SESSION_SECRET;
  if (!token || req.query.token !== token) {
    return res.status(403).type('text/plain').send('Zły token dostępu do kanału.');
  }

  const [users] = await pool.query('SELECT id, email FROM users');
  const items = [];
  for (const u of users) {
    const [rows] = await pool.query(
      `SELECT kind, payload, created_at FROM notification_events
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [u.id]
    );
    for (const r of rows) {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const title =
        r.kind === 'new_edition'
          ? `Nowe wydanie: ${payload.title || ''}`
          : `Brakuje: ${payload.title || ''}`;
      const desc =
        r.kind === 'new_edition'
          ? `${payload.ownedAuthor || ''} — ${payload.ownedTitle || ''} (rok ${payload.ownedYear || '?'}) ma nowsze wydanie z ${payload.publishYear || '?'}. ISBN: ${payload.isbn || 'brak'}`
          : `Autor ${payload.author || ''} ma w Open Library książkę, której nie masz na półce. Pierwsze wydanie: ${payload.firstPublishYear || '?'}.`;
      const guid = `${u.id}-${r.kind}-${payload.workKey || payload.editionKey || Math.random()}`;
      items.push({
        title,
        desc,
        date: r.created_at,
        guid,
      });
    }
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const max = items.slice(0, 50);

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ksiazkomat — nowe wydania i brakujące książki</title>
    <link>${escapeXml(req.protocol)}://${escapeXml(req.get('host'))}</link>
    <description>Domowy spis biblioteczki</description>
    ${max
      .map(
        (it) => `<item>
      <title>${escapeXml(it.title)}</title>
      <guid isPermaLink="false">${escapeXml(it.guid)}</guid>
      <pubDate>${new Date(it.date).toUTCString()}</pubDate>
      <description>${escapeXml(it.desc)}</description>
    </item>`
      )
      .join('\n    ')}
  </channel>
</rss>`;

  res.type('application/rss+xml').send(feed);
});

export default router;
