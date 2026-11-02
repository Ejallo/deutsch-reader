import { useState } from 'react';
import { updateSettings } from '../lib/store';
import { listModels, pickDefaultModel } from '../lib/gemini';

interface Props {
  onDone: () => void;
  onSkip?: () => void;
}

/** First-run step: without a Gemini key nothing gets translated, so ask for it up front. */
export function KeyStep({ onDone, onSkip }: Props) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const k = key.trim();
    if (!k) return setError('Вставь ключ');
    setBusy(true);
    setError('');
    try {
      const model = pickDefaultModel(await listModels(k));
      updateSettings({ geminiKey: k, geminiModel: model });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <h1>Ключ для перевода</h1>
      <p className="muted">Переводит и создаёт тексты ИИ Google Gemini. Ему нужен твой личный ключ — это бесплатно и займёт минуту.</p>
      <ol className="key-steps">
        <li>
          Открой{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>{' '}
          и войди в Google-аккаунт.
        </li>
        <li>
          Нажми <b>Create API key</b> и скопируй ключ — он начинается с <b>AIza</b>.
        </li>
        <li>Вставь его сюда.</li>
      </ol>
      <label className="field">
        <span>Ключ Gemini</span>
        <input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError('');
          }}
          placeholder="AIza…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary wide" disabled={busy} onClick={() => void save()}>
        {busy ? 'Проверяю ключ…' : 'Сохранить и начать'}
      </button>
      {onSkip && (
        <button className="link" onClick={onSkip}>
          Позже
        </button>
      )}
    </div>
  );
}
