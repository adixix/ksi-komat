const API = {
  async request(path, options = {}) {
    const opts = {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    const res = await fetch(path, opts);
    if (res.status === 401) {
      throw new AuthError('Zaloguj się.');
    }
    if (!res.ok) {
      let msg = `Błąd ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  get: (path) => API.request(path),
  post: (path, body) => API.request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => API.request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => API.request(path, { method: 'DELETE' }),
};

class AuthError extends Error {
  constructor(msg) {
    super(msg);
    this.isAuth = true;
  }
}

export default API;
