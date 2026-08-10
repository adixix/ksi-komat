import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).toLowerCase())) {
    return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Hasło musi mieć co najmniej 6 znaków.' });
  }
  const normalized = String(email).toLowerCase();
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalized]);
  if (existing.length) {
    return res.status(409).json({ error: 'Konto z tym e-mailem już istnieje.' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  const [result] = await pool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
    normalized,
    hash,
  ]);
  req.session.userId = result.insertId;
  res.status(201).json({ id: result.insertId, email: normalized });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalized = String(email || '').toLowerCase();
  const [rows] = await pool.query('SELECT id, email, password_hash FROM users WHERE email = ?', [
    normalized,
  ]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Nieprawidłowy e-mail lub hasło.' });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Zaloguj się.' });
  const [rows] = await pool.query('SELECT id, email FROM users WHERE id = ?', [req.session.userId]);
  if (!rows.length) return res.status(401).json({ error: 'Zaloguj się.' });
  res.json(rows[0]);
});

export default router;
