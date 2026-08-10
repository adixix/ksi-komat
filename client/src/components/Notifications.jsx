import { useCallback, useEffect, useState } from 'react';
import API from '../api.js';

const localeComparePl = (a, b) => String(a).localeCompare(String(b), 'pl');

const MISSING_SORTS = [
  { value: 'author-asc', label: 'Autor A–Z' },
  { value: 'author-desc', label: 'Autor Z–A' },
  { value: 'title-asc', label: 'Tytuł A–Z' },
  { value: 'year-asc', label: 'Rok — od najstarszych' },
  { value: 'year-desc', label: 'Rok — od najnowszych' },
];

const EDITION_SORTS = [
  { value: 'title-asc', label: 'Tytuł A–Z' },
  { value: 'title-desc', label: 'Tytuł Z–A' },
  { value: 'year-desc', label: 'Rok — od najnowszych' },
  { value: 'year-asc', label: 'Rok — od najstarszych' },
  { value: 'author-asc', label: 'Autor A–Z' },
];

export default function Notifications() {
  const [tab, setTab] = useState('missing');
  const [missing, setMissing] = useState([]);
  const [editions, setEditions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [missingFilter, setMissingFilter] = useState([]);
  const [editionFilter, setEditionFilter] = useState([]);
  const [sortMissing, setSortMissing] = useState('author-asc');
  const [sortEditions, setSortEditions] = useState('title-asc');
  const [expanded, setExpanded] = useState(() => new Set());
  const [adding, setAdding] = useState(() => new Set());
  const [added, setAdded] = useState(() => new Set());

  const toggleGroup = (name) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [m, e, n] = await Promise.all([
        API.get('/api/discovery/missing'),
        API.get('/api/discovery/new-editions'),
        API.get('/api/discovery/notifications'),
      ]);
      setMissing(m);
      setEditions(e);
      setNotifications(n);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.post('/api/discovery/refresh', {});
      await load();
      alert(
        `Odświeżono. Brakujące książki: ${res.missing}, nowe wydania: ${res.newEditions}.` +
          (res.resolvedAuthors ? ` Rozpoznano autorów w Open Library: ${res.resolvedAuthors}.` : '')
      );
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const addWanted = async (w) => {
    setAdding((prev) => new Set(prev).add(w.workKey));
    setError('');
    try {
      await API.post('/api/books', {
        title: w.title,
        author: w.author,
        authorKey: w.authorKey,
        workKey: w.workKey,
        publishYear: w.firstPublishYear,
        coverUrl: w.coverUrl,
        status: 'wanted',
      });
      setAdded((prev) => new Set(prev).add(w.workKey));
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(w.workKey);
        return next;
      });
    }
  };

  const unseen = notifications.filter((n) => !n.seen).length;

  const missingAuthors = [...new Set(missing.map((m) => m.author))].sort(localeComparePl);
  const editionAuthors = [...new Set(editions.map((e) => e.ownedAuthor))].sort(localeComparePl);

  const filteredMissing =
    missingFilter.length === 0 ? missing : missing.filter((m) => missingFilter.includes(m.author));
  const filteredEditions =
    editionFilter.length === 0 ? editions : editions.filter((e) => editionFilter.includes(e.ownedAuthor));

  const groupSort = (a, b) => {
    if (sortMissing === 'year-asc') return (a.firstPublishYear || 0) - (b.firstPublishYear || 0);
    if (sortMissing === 'year-desc') return (b.firstPublishYear || 0) - (a.firstPublishYear || 0);
    return localeComparePl(a.title, b.title);
  };
  const grouped = (Object.groupBy ? Object.groupBy(filteredMissing, (m) => m.author) : filteredMissing.reduce((acc, m) => {
    (acc[m.author] = acc[m.author] || []).push(m);
    return acc;
  }, {}));
  Object.values(grouped).forEach((works) => works.sort(groupSort));
  const groupNames = Object.keys(grouped).sort((a, b) =>
    sortMissing === 'author-desc' ? localeComparePl(b, a) : localeComparePl(a, b)
  );

  const editionSortFn = (a, b) => {
    switch (sortEditions) {
      case 'title-desc':
        return localeComparePl(b.title, a.title);
      case 'year-desc':
        return (b.publishYear || 0) - (a.publishYear || 0);
      case 'year-asc':
        return (a.publishYear || 0) - (b.publishYear || 0);
      case 'author-asc':
        return localeComparePl(a.ownedAuthor, b.ownedAuthor) || localeComparePl(a.title, b.title);
      default:
        return localeComparePl(a.title, b.title);
    }
  };
  const sortedEditions = [...filteredEditions].sort(editionSortFn);

  const groupedEditions = sortedEditions.reduce((acc, e) => {
    (acc[e.ownedAuthor] = acc[e.ownedAuthor] || []).push(e);
    return acc;
  }, {});
  const editionGroupNames = Object.keys(groupedEditions).sort(localeComparePl);

  const currentGroupNames = tab === 'missing' ? groupNames : editionGroupNames;
  const expandAll = () => setExpanded(new Set(currentGroupNames));
  const collapseAll = () => setExpanded(new Set());

  const toggleFilter = (list, setter, value) =>
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const authors = tab === 'missing' ? missingAuthors : editionAuthors;
  const authorFilter = tab === 'missing' ? missingFilter : editionFilter;
  const setAuthorFilter = tab === 'missing' ? setMissingFilter : setEditionFilter;
  const sort = tab === 'missing' ? sortMissing : sortEditions;
  const setSort = tab === 'missing' ? setSortMissing : setSortEditions;
  const sortOptions = tab === 'missing' ? MISSING_SORTS : EDITION_SORTS;
  const resultCount = tab === 'missing' ? filteredMissing.length : sortedEditions.length;

  return (
    <div>
      <div className="head-row">
        <h2>Wykrywanie</h2>
        <button className="btn primary" onClick={refresh} disabled={loading}>
          {loading ? '…' : 'Odśwież dane z Open Library'}
        </button>
      </div>
      <p className="muted">
        Sprawdzamy autorów z Twojej półki w Open Library — jakie jeszcze mają książki, których nie masz,
        oraz czy posiadane tytuły doczekały się nowszych wydań. Wyniki możesz też śledzić przez RSS
        (fundament pod powiadomienia e-mail).
        {unseen > 0 && <strong> Nowych zdarzeń: {unseen}.</strong>}
      </p>

      {error && <p className="error">{error}</p>}

      <nav className="tabs">
        <button
          className={`tab ${tab === 'missing' ? 'active' : ''}`}
          onClick={() => setTab('missing')}
        >
          📖 Brakujące książki ({missing.length})
        </button>
        <button
          className={`tab ${tab === 'editions' ? 'active' : ''}`}
          onClick={() => setTab('editions')}
        >
          🆕 Nowe wydania ({editions.length})
        </button>
      </nav>

      {authors.length > 0 && (
        <div className="filter-row">
          <span className="muted">Autorzy:</span>
          <button
            className={`chip ${authorFilter.length === 0 ? 'active' : ''}`}
            onClick={() => setAuthorFilter([])}
          >
            Wszyscy
          </button>
          {authors.map((a) => (
            <button
              key={a}
              className={`chip ${authorFilter.includes(a) ? 'active' : ''}`}
              onClick={() => toggleFilter(authorFilter, setAuthorFilter, a)}
            >
              {a}
            </button>
          ))}
          <select className="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                Sortuj: {o.label}
              </option>
            ))}
          </select>
          <span className="muted">{resultCount} wyników</span>
        </div>
      )}

      {loading ? (
        <p className="muted">Wczytywanie…</p>
      ) : tab === 'missing' ? (
        groupNames.length === 0 ? (
          <p className="muted">Brak wyników — dodaj książki z powiązanym autorem (np. przez ISBN).</p>
        ) : (
          <>
            <div className="row actions group-actions">
              <button type="button" className="btn ghost sm" onClick={collapseAll}>
                Zwiń wszystkie
              </button>
              <button type="button" className="btn ghost sm" onClick={expandAll}>
                Rozwiń wszystkie
              </button>
            </div>
            {groupNames.map((author) => {
              const open = expanded.has(author);
              return (
                <section className="group" key={author}>
                  <button type="button" className="group-head" onClick={() => toggleGroup(author)}>
                    <span className={`group-arrow ${open ? 'open' : ''}`}>▸</span>
                    <span className="group-name">{author}</span>
                    <span className="group-count">{grouped[author].length}</span>
                  </button>
                  {open && (
                    <div className="work-list">
                      {grouped[author].map((w) => (
                        <div className="work" key={w.workKey}>
                          {w.coverUrl ? (
                            <img className="cover sm" src={w.coverUrl} alt="" loading="lazy" />
                          ) : (
                            <div className="cover placeholder sm">📖</div>
                          )}
                          <div>
                            <p className="title">{w.title}</p>
                            <p className="meta">
                              {w.firstPublishYear ? `Pierwsze wydanie: ${w.firstPublishYear}` : '—'}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={`btn sm ${added.has(w.workKey) ? 'ghost' : 'primary'}`}
                            disabled={adding.has(w.workKey) || added.has(w.workKey)}
                            onClick={() => addWanted(w)}
                            style={{ marginLeft: 'auto' }}
                          >
                            {adding.has(w.workKey)
                              ? '…'
                              : added.has(w.workKey)
                              ? '✓ Dodano'
                              : 'Planuję zakup'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )
      ) : sortedEditions.length === 0 ? (
        <p className="muted">
          Brak nowszych wydań — po uzupełnieniu półki (najlepiej przez ISBN) kliknij „Odśwież dane”.
        </p>
      ) : (
        <>
          <div className="row actions group-actions">
            <button type="button" className="btn ghost sm" onClick={collapseAll}>
              Zwiń wszystkie
            </button>
            <button type="button" className="btn ghost sm" onClick={expandAll}>
              Rozwiń wszystkie
            </button>
          </div>
          {editionGroupNames.map((author) => {
            const open = expanded.has(author);
            return (
              <section className="group" key={author}>
                <button type="button" className="group-head" onClick={() => toggleGroup(author)}>
                  <span className={`group-arrow ${open ? 'open' : ''}`}>▸</span>
                  <span className="group-name">{author}</span>
                  <span className="group-count">{groupedEditions[author].length}</span>
                </button>
                {open && (
                  <div className="work-list">
                    {groupedEditions[author].map((e, i) => (
                      <div className="work" key={`${e.workKey}-${e.editionKey || i}`}>
                        {e.coverUrl ? (
                          <img className="cover sm" src={e.coverUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="cover placeholder sm">🆕</div>
                        )}
                        <div>
                          <p className="title">{e.title}</p>
                          <p className="meta">
                            Nowe wydanie z <strong>{e.publishYear}</strong> (masz z {e.ownedYear}) ·{' '}
                            {e.ownedAuthor}
                            {e.isbn ? ` · ISBN ${e.isbn}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
