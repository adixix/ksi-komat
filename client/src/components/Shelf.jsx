import { useEffect, useState } from 'react';
import API from '../api.js';
import BookForm from './BookForm.jsx';

const STATUS_LABELS = {
  owned: 'Półka',
  read: 'Przeczytana',
  wanted: 'Chcę',
  loaned: 'Wypożyczona',
};

const SORT_OPTIONS = [
  { value: 'author-asc', label: 'Autor A–Z' },
  { value: 'title-asc', label: 'Tytuł A–Z' },
  { value: 'title-desc', label: 'Tytuł Z–A' },
  { value: 'year-desc', label: 'Rok — od najnowszych' },
  { value: 'year-asc', label: 'Rok — od najstarszych' },
  { value: 'created-desc', label: 'Data dodania — najnowsze' },
  { value: 'created-asc', label: 'Data dodania — najstarsze' },
  { value: 'status-asc', label: 'Status' },
];

export default function Shelf() {
  const [books, setBooks] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('author-asc');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const [sortKey, dir] = sort.split('-');
      params.set('sort', sortKey);
      params.set('dir', dir);
      const data = await API.get(`/api/books?${params}`);
      setBooks(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, status, sort]);

  const changeStatus = async (book, next) => {
    if (next === book.status) return;
    try {
      await API.put(`/api/books/${book.id}`, { status: next });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (book) => {
    if (!confirm(`Usunąć „${book.title}”?`)) return;
    await API.delete(`/api/books/${book.id}`);
    load();
  };

  return (
    <div>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Szukaj: tytuł, autor, ISBN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Wszystkie statusy</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sortuj: {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Wczytywanie…</p>
      ) : books.length === 0 ? (
        <p className="muted">Półka jest pusta. Przejdź do zakładki „Dodaj”.</p>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <article className="card book" key={b.id}>
              {b.coverUrl ? (
                <img className="cover" src={b.coverUrl} alt="" loading="lazy" />
              ) : (
                <div className="cover placeholder">📕</div>
              )}
              <div className="book-body">
                <h3>{b.title}</h3>
                <p className="author">{b.author}</p>
                <p className="meta">
                  {b.publishYear ? `${b.publishYear}` : '—'}
                  {b.isbn ? ` · ${b.isbn}` : ''}
                </p>
                <select
                  className={`badge status-select status-${b.status}`}
                  value={b.status}
                  onChange={(e) => changeStatus(b, e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                {b.notes && <p className="notes">{b.notes}</p>}
                <div className="book-actions">
                  <button className="btn ghost sm" onClick={() => setEditing(b)}>
                    Edytuj
                  </button>
                  <button className="btn danger sm" onClick={() => remove(b)}>
                    Usuń
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-inner">
            <h2>Edytuj książkę</h2>
            <BookForm
              initial={editing}
              onSubmit={async (data) => {
                await API.put(`/api/books/${editing.id}`, data);
                setEditing(null);
                load();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
