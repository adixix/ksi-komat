import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';

dotenv.config();

import authRouter from './routes/auth.js';
import booksRouter from './routes/books.js';
import discoveryRouter from './routes/discovery.js';
import feedRouter from './routes/feed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3001);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

if (isProd) app.set('trust proxy', 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-zmien-mnie',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isProd) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Zaloguj się.' });
  next();
}

app.use('/api/auth', authRouter);
app.use('/api/books', requireAuth, booksRouter);
app.use('/api/discovery', requireAuth, discoveryRouter);
app.use(feedRouter);

app.use('/health', (req, res) => res.json({ ok: true }));

if (isProd) {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Wewnętrzny błąd serwera.' });
});

app.listen(PORT, () => {
  console.log(`Ksiazkomat API na http://localhost:${PORT} (${isProd ? 'prod' : 'dev'})`);
});
