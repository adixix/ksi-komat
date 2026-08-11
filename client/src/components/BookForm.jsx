import { useEffect, useRef, useState } from 'react';
import API from '../api.js';

const STATUSES = [
  { id: 'owned', label: 'Mam na półce' },
  { id: 'read', label: 'Przeczytana' },
  { id: 'wanted', label: 'Planuję zakup' },
  { id: 'loaned', label: 'Wypożyczona' },
];

export default function BookForm({ initial = null, onSubmit, onCancel, allowSaveAndNew = false }) {
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
  const [gbQuery, setGbQuery] = useState('');
  const [gbList, setGbList] = useState([]);
  const [gbLoading, setGbLoading] = useState(false);
  const [wdQuery, setWdQuery] = useState('');
  const [wdList, setWdList] = useState([]);
  const [wdLoading, setWdLoading] = useState(false);
  const scannerRef = useRef(null);
  const scannedRef = useRef(false);
  const scannerDivId = 'isbn-scanner';

  const doLookup = async (e, explicitIsbn) => {
    e?.preventDefault();
    const clean = (typeof explicitIsbn === 'string' && explicitIsbn ? explicitIsbn : isbn).replace(/[^0-9Xx]/g, '');
    if (clean.length !== 10 && clean.length !== 13) {
      setError('Podaj poprawny ISBN (10 lub 13 cyfr).');
      return;
    }
    setError('');
    setGbList([]);
    setWdList([]);
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

  const searchGB = async () => {
    const q = gbQuery.trim();
    if (!q) return;
    setGbLoading(true);
    setError('');
    try {
      const list = await API.post('/api/books/gb-search', { q });
      setGbList(list);
      if (!list.length) setError('Brak wyników w Google Books — wpisz dane ręcznie.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGbLoading(false);
    }
  };

  const pickGB = (r) => {
    setTitle(r.title || '');
    setAuthor(r.author || '');
    setPublisher(r.publisher || '');
    setPublishYear(r.publishYear || '');
    setCoverUrl(r.coverUrl || '');
    setAuthorKey(null);
    setWorkKey(null);
    setAuthorMatched(null);
    setLookup('done');
    setGbList([]);
    setGbQuery('');
  };

  const searchWD = async () => {
    const q = wdQuery.trim();
    if (!q) return;
    setWdLoading(true);
    setError('');
    try {
      const list = await API.post('/api/books/wikidata-search', { title: q });
      setWdList(list);
      if (!list.length) setError('Brak wyników w Wikidacie — wpisz dane ręcznie.');
    } catch (err) {
      setError(err.message);
    } finally {
      setWdLoading(false);
    }
  };

  const pickWD = (r) => {
    setTitle(r.title || '');
    setAuthor(r.author || '');
    setPublisher(r.publisher || '');
    setPublishYear(r.publishYear || '');
    setCoverUrl(r.coverUrl || '');
    setAuthorKey(r.authorKey || null);
    setWorkKey(r.workKey || null);
    setAuthorMatched(r.authorKey ? { name: r.author } : null);
    setLookup('done');
    setWdList([]);
    setWdQuery('');
    setGbList([]);
    setGbQuery('');
  };

  const runWdCoverSearch = async () => {
    setCoverLoading(true);
    try {
      const list = await API.post('/api/books/wikidata-covers', {
        title: coverQuery,
        author: coverAuthor,
      });
      setCoverList(list);
      if (!list.length) setError('Brak okładek z Commons — spróbuj innego tytułu.');
    } catch (err) {
      setError(err.message);
    } finally {
      setCoverLoading(false);
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      try {
        scannerRef.current.stop().catch(() => {});
      } catch {}
      try {
        scannerRef.current.clear().catch(() => {});
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScanner = () => {
    scannedRef.current = false;
    setError('');
    setScanning(true);
  };

  useEffect(() => {
    if (!scanning) return undefined;
    let disposed = false;
    const init = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (disposed) return;
        const scanner = new Html5Qrcode(scannerDivId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 160 } },
          (text) => {
            if (disposed || scannedRef.current) return;
            scannedRef.current = true;
            setIsbn(text);
            setScanning(false);
            doLookup(null, text);
          },
          () => {}
        );
      } catch (err) {
        if (disposed) return;
        setError('Nie udało się uruchomić kamery: ' + (err.message || err));
        setScanning(false);
      }
    };
    init();
    return () => {
      disposed = true;
      stopScanner();
    };
  }, [scanning]);

  useEffect(() => () => stopScanner(), []);

  const resetForm = () => {
    setIsbn('');
    setLookup('idle');
    setTitle('');
    setAuthor('');
    setPublisher('');
    setPublishYear('');
    setEdition('');
    setNotes('');
    setStatus('owned');
    setCoverUrl('');
    setAuthorKey(null);
    setWorkKey(null);
    setAuthorMatched(null);
    setGbQuery('');
    setGbList([]);
    setWdQuery('');
    setWdList([]);
    setError('');
  };

  const submit = async (e, andNew = false) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(
        {
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
        },
        andNew
      );
      if (andNew) resetForm();
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
          <div id={scannerDivId} className="scanner" style={scanning ? undefined : { display: 'none' }} />
          {lookup === 'loading' && <p className="muted">Szukam danych (Open Library, Biblioteka Narodowa, Google Books, Wikidata)…</p>}
          {lookup === 'notfound' && (
            <div className="gb-search">
              <p className="muted">
                Nie znaleziono o tym ISBN w Open Library ani Google Books — wyszukaj po tytule:
              </p>
              <div className="row">
                <input
                  className="grow"
                  placeholder="Tytuł lub autor…"
                  value={gbQuery}
                  onChange={(e) => setGbQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchGB()}
                />
                <button type="button" className="btn secondary" onClick={searchGB} disabled={gbLoading}>
                  {gbLoading ? '…' : 'Szukaj w Google Books'}
                </button>
              </div>
              {gbList.length > 0 && (
                <div className="cover-grid">
                  {gbList.map((r) => (
                    <button type="button" key={r.id} className="cover-option" onClick={() => pickGB(r)}>
                      {r.coverUrl ? (
                        <img src={r.coverUrl} alt={r.title} loading="lazy" />
                      ) : (
                        <div className="cover-option-placeholder">📕</div>
                      )}
                      <span>
                        {r.title}
                        {r.publishYear ? ` (${r.publishYear})` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <input
                  className="grow"
                  placeholder="Tytuł lub autor (Wikidata)…"
                  value={wdQuery}
                  onChange={(e) => setWdQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchWD()}
                />
                <button type="button" className="btn secondary" onClick={searchWD} disabled={wdLoading}>
                  {wdLoading ? '…' : 'Szukaj w Wikidacie'}
                </button>
              </div>
              {wdList.length > 0 && (
                <div className="cover-grid">
                  {wdList.map((r) => (
                    <button type="button" key={r.id} className="cover-option" onClick={() => pickWD(r)}>
                      {r.coverUrl ? (
                        <img src={r.coverUrl} alt={r.title} loading="lazy" />
                      ) : (
                        <div className="cover-option-placeholder">📕</div>
                      )}
                      <span>
                        {r.title}
                        {r.publishYear ? ` (${r.publishYear})` : ''}
                        {r.workKey ? ' · OL ✓' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
        {!initial && allowSaveAndNew && (
          <button type="button" className="btn secondary" disabled={busy} onClick={(e) => submit(e, true)}>
            {busy ? '…' : 'Zapisz i dodaj nową'}
          </button>
        )}
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
              <button
                type="button"
                className="btn secondary"
                disabled={coverLoading}
                onClick={runWdCoverSearch}
              >
                {coverLoading ? '…' : 'Wikidata'}
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
                    key={c.workKey || c.id}
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
