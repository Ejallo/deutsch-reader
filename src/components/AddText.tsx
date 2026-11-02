import { useState } from 'react';
import { addText } from '../lib/store';

interface Props {
  onBack: () => void;
  onSaved: (id: string) => void;
}

export function AddText({ onBack, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const text = content.trim();
    if (!text) {
      setError('Вставь текст');
      return;
    }
    const name = title.trim() || text.split(/\s+/).slice(0, 5).join(' ') + '…';
    onSaved(addText(name, text));
  };

  return (
    <div className="screen">
      <header className="bar">
        <button className="link" onClick={onBack}>
          ‹ Назад
        </button>
        <h1>Новый текст</h1>
        <span />
      </header>
      <label className="field">
        <span>Название (необязательно)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kapitel 1" />
      </label>
      <label className="field">
        <span>Текст на немецком</span>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setError('');
          }}
          rows={14}
          placeholder="Es war einmal…"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary wide" onClick={save}>
        Сохранить и читать
      </button>
    </div>
  );
}
