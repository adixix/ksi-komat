import { useState } from 'react';
import API from '../api.js';
import BookForm from './BookForm.jsx';

export default function AddBook({ onAdded }) {
  const [message, setMessage] = useState('');

  const add = async (data) => {
    await API.post('/api/books', data);
    setMessage(`Dodano: „${data.title}”.`);
    onAdded();
  };

  return (
    <div>
      <h2>Dodaj książkę</h2>
      <p className="muted">
        Wklej kod ISBN (możesz go zeskanować wcześniej na telefonie) albo użyj kamery — dane pobierane są
        z Open Library i możesz je poprawić ręcznie.
      </p>
      {message && <p className="success">{message}</p>}
      <BookForm onSubmit={add} allowSaveAndNew />
    </div>
  );
}
