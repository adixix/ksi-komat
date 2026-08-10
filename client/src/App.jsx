import { useEffect, useState } from 'react';
import API from './api.js';
import Login from './components/Login.jsx';
import Shelf from './components/Shelf.jsx';
import AddBook from './components/AddBook.jsx';
import Notifications from './components/Notifications.jsx';

const TABS = [
  { id: 'shelf', label: 'Półka', icon: '📚' },
  { id: 'add', label: 'Dodaj', icon: '➕' },
  { id: 'notifications', label: 'Wykrywanie', icon: '🔎' },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('shelf');

  useEffect(() => {
    API.get('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="center">Wczytywanie…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const logout = async () => {
    await API.post('/api/auth/logout', {});
    setUser(null);
  };

  return (
    <div className="app">
      <header>
        <h1>
          <span className="logo">📚</span> Książkomat
        </h1>
        <div className="user">
          <span className="email">{user.email}</span>
          <button className="btn ghost" onClick={logout}>
            Wyloguj
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'shelf' && <Shelf />}
        {tab === 'add' && <AddBook onAdded={() => setTab('shelf')} />}
        {tab === 'notifications' && <Notifications />}
      </main>
    </div>
  );
}
