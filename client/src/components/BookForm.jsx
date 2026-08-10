import { useEffect, useRef, useState } from 'react';
import API from '../api.js';

const STATUSES = [
  { id: 'owned', label: 'Mam na półce' },
  { id: 'read', label: 'Przeczytana' },
  { id: 'wanted', label: 'Chcę mieć' },
  { id: 'loaned', label: 'Wypożyczona' },
];

export default function BookForm({ initial = null, onSubmit, onCancel }) {
  const [isbn, setIsbn] = useState(initial?.isbn || '');
  const [lookup, setLookup] = useState(initial ? 'loaded' : 'idle');
  const [title, setTitle] = useState(initial?.title || '');
  const [author, setAuthor] = useState(initial?.author || '');
  const [publisher, setPublisher] = useState(initial?.publisher || '');
  const [publishYear, setPublishYear] = useState(initial?.publishYear || '');
  const [edition, setEdition] = useState(initial?.edition || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [status, setStatus] = useState(initial?.status || 'owned');
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl || '');
  const [authorKey, setAuthorKey] = useState(initial?.authorKey || null);
  const [workKey, setWorkKey] = useState(initial?.workKey || null);
  const [authorMatched, setAuthorMatched] = useState(
    initial?.authorKey ? { name: initial.author } : null
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [coverModal, setCoverModal] = useState(false);
  const [coverList, setCoverList] = useState([]);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverQuery, setCoverQuery] = useState('');
  const [coverAuthor, setCoverAuthor] = useState('');
  const scannerRef = useRef(null);
  const scannerDivId = 'isbn-scanner';

  const doLookup = async (e) => {
    e?.preventDefault();
    const clean = isbn.replace(/[^0-9Xx]/g, '');
    if (clean.length !== 10 && clean.length !== 13) {
      setError('Podaj poprawny ISBN (10 lub 13 cyfr).');
      return;
    }
    setError('');
    setBusy(true);
    setLookup('loading');
    try {
      const data = await API.post('/api/books/lookup', { isbn: clean });
      setTitle(data.title);
      setAuthor(data.author);
      setPublisher(data.publisher || '');
      setPublishYear(data.publishYear || '');
      setCoverUrl(data.coverUrl || '');
      setAuthorKey(data.authorKey);
      setWorkKey(data.workKey);
      setAuthorMatched(data.authorKey ? { name: data.author } : null);
      setLookup('done');
    } catch (err) {
      setError(err.message);
      setLookup('notfound');
    } finally {
      setBusy(false);
    }
  };

  const findAuthor = async () => {
    if (!author.trim()) {
      setError('Najpierw wpisz nazwisko autora.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await API.post('/api/books/resolve-author', { author });
      if (r.key) {
        setAuthorKey(r.key);
        setAuthor(r.name || author);
        setAuthorMatched({ name: r.name || author });
      } else {
        setAuthorMatched(null);
        setError('Nie znaleziono tego autora w Open Library.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openCoverModal = () => {
    setCoverQuery(title);
    setCoverAuthor(author);
    setCoverModal(true);
    setCoverList([]);
    runCoverSearch(title, author);
  };

  const runCoverSearch = async (q, a) => {
    setCoverLoading(true);
    try {
      const list = await API.post('/api/books/cover-search', { title: q, author: a });
      setCoverList(list);
    } catch (err) {
      setCoverList([]);
      setError(err.message);
    } finally {
      setCoverLoading(false);
    }
  };

  const coverEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCoverSearch(coverQuery, coverAuthor);
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current.clear().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScanner = async () => {
    setError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      scannerRef.current = new Html5Qrcode(scannerDivId);
      await scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 160 } },
        (text) => {
          setIsbn(text);
          stopScanner();
          doLookup();
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      setError('Nie udało się uruchomić kamery: ' + (err.message || err));
    }
  };

  useEffect(() => () => stopScanner(), []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({
        isbn: isbn || null,
        title,
        author,
        publisher: publisher || null,
        publishYear: publishYear ? Number(publishYear) : null,
        edition: edition || null,
        notes: notes || null,
        status,
        coverUrl: coverUrl || null,
        authorKey,
        workKey,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      {!initial && (
        <fieldset className="isbn-box">
          <legend>Kod ISBN</legend>
          <div className="row">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Wpisz lub wklej ISBN…"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doLookup(e)}
            />
            <button type="button" className="btn secondary" onClick={doLookup} disabled={busy || scanning}>
              Pobierz dane
            </button>
            <button type="button" className="btn secondary" onClick={scanning ? stopScanner : startScanner}>
              {scanning ? 'Zatrzymaj' : 'Skanuj 📷'}
            </button>
          </div>
          {scanning && <div id={scannerDivId} className="scanner" />}
          {lookup === 'notfound' && (
            <p className="muted">Nie znaleziono w Open Library — uzupełnij dane ręcznie.</p>
          )}
        </fieldset>
      )}

      <label>
        Tytuł *
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Autor *
        <div className="row">
          <input
            className="grow"
            value={author}
            onChange={(e) => {
              setAuthor(e.target.value);
              setAuthorKey(null);
              setAuthorMatched(null);
            }}
            required
          />
          <button
            type="button"
            className="btn secondary"
            onClick={findAuthor}
            disabled={busy || scanning}
            title="Znajdź autora w Open Library (włączy wykrywanie brakujących książek)"
          >
            Znajdź w OL
          </button>
        </div>
        {authorMatched && (
          <span className="author-ok">✓ Znaleziono autora w Open Library</span>
        )}
      </label>
      <div className="row">
        <label className="grow">
          Wydawca
          <input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </label>
        <label>
          Rok wydania
          <input
            type="number"
            value={publishYear}
            onChange={(e) => setPublishYear(e.target.value)}
            min={1000}
            max={2100}
          />
        </label>
      </div>
      <div className="row">
        <label className="grow">
          Wydanie / numer
          <input value={edition} onChange={(e) => setEdition(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Okładka
        <div className="row">
          {coverUrl ? (
            <>
              <img className="cover-preview" src={coverUrl} alt="okładka" loading="lazy" />
              <button type="button" className="btn ghost sm" onClick={openCoverModal}>
                Zmień okładkę
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setCoverUrl('')}>
                Usuń okładkę
              </button>
            </>
          ) : (
            <button type="button" className="btn secondary" onClick={openCoverModal}>
              {lookup === 'done' ? 'Brak okładki — wybierz z Open Library' : 'Znajdź okładkę w Open Library'}
            </button>
          )}
        </div>
      </label>
      <label>
        Notatki
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="row actions">
        <button className="btn primary" disabled={busy}>
          {busy ? '…' : initial ? 'Zapisz' : 'Dodaj do półki'}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
        )}
      </div>

      {coverModal && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setCoverModal(false)}>
          <div className="modal-inner">
            <h2>Wybierz okładkę z Open Library</h2>
            <p className="muted">
              Jeśli to polskie wydanie, a Open Library zna tylko oryginał — wpisz tytuł oryginału
              (np. „The Killing Zone") albo zostaw autora i wyszukaj.
            </p>
            <div className="row">
              <input
                className="grow"
                placeholder="Tytuł…"
                value={coverQuery}
                onChange={(e) => setCoverQuery(e.target.value)}
                onKeyDown={coverEnter}
              />
              <input
                className="grow"
                placeholder="Autor…"
                value={coverAuthor}
                onChange={(e) => setCoverAuthor(e.target.value)}
                onKeyDown={coverEnter}
              />
              <button
                type="button"
                className="btn primary"
                disabled={coverLoading}
                onClick={() => runCoverSearch(coverQuery, coverAuthor)}
              >
                {coverLoading ? '…' : 'Szukaj'}
              </button>
            </div>
            {coverLoading ? (
              <p className="muted">Szukanie w Open Library…</p>
            ) : coverList.length === 0 ? (
              <p className="muted">Brak wyników z okładkami. Spróbuj innego tytułu.</p>
            ) : (
              <div className="cover-grid">
                {coverList.map((c) => (
                  <button
                    type="button"
                    key={c.workKey}
                    className={`cover-option ${c.coverUrl === coverUrl ? 'selected' : ''}`}
                    onClick={() => {
                      setCoverUrl(c.coverUrl);
                      setCoverModal(false);
                    }}
                  >
                    <img src={c.coverUrl} alt={c.title} loading="lazy" />
                    <span>
                      {c.title}
                      {c.year ? ` (${c.year})` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="row actions">
              <button type="button" className="btn ghost" onClick={() => setCoverModal(false)}>
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
