import { useCallback, useState } from 'react';
import { connect, connectWithCode } from '../lib/sync';
import { QrScanner } from './QrScanner';
import { GoogleButton } from './GoogleButton';
import { Mascot } from './ui';

type Mode = 'choose' | 'token' | 'scan' | 'code';

interface Props {
  onDone: () => void;
  embedded?: boolean;
}

export function Setup({ onDone, embedded }: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('deutsch-reader-data');
  const [owner, setOwner] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onScanned = useCallback((c: string) => {
    setMode('code');
    setCode(c);
    void run(() => connectWithCode(c));
  }, []);

  return (
    <div className={embedded ? '' : 'screen'}>
      {!embedded && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Mascot size={110} mood="happy" />
          <h1 style={{ marginTop: 18 }}>Deutsch Reader</h1>
          <p className="muted">Войди, чтобы словарь и прогресс были и на телефоне, и на компе — и не терялись.</p>
        </div>
      )}

      {mode === 'choose' && (
        <div className="stack">
          <GoogleButton />
          {!embedded && (
            <button className="link" onClick={onDone}>
              Пока без входа
            </button>
          )}
          <details className="other-ways">
            <summary>Другие способы (свой GitHub)</summary>
            <div className="stack">
              <button className="wide" onClick={() => setMode('token')}>
                Первое устройство: ввести токен GitHub
              </button>
              <button className="wide" onClick={() => setMode('scan')}>
                Сканировать QR с другого устройства
              </button>
              <button className="wide" onClick={() => setMode('code')}>
                Вставить код подключения
              </button>
            </div>
          </details>
        </div>
      )}

      {mode === 'token' && (
        <div className="stack">
          <label className="field">
            <span>Токен GitHub (fine-grained, доступ только к репозиторию с данными)</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          </label>
          <label className="field">
            <span>Приватный репозиторий для данных</span>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} />
          </label>
          <label className="field">
            <span>Логин GitHub (если не определится сам)</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="необязательно" autoCapitalize="off" />
          </label>
          <button
            className="chunky c-peach wide"
            disabled={busy}
            onClick={() => {
              if (!token.trim() || !repo.trim()) return setError('Заполни токен и репозиторий');
              void run(() => connect(token, repo, owner));
            }}
          >
            {busy ? 'Проверяю…' : 'Подключить'}
          </button>
        </div>
      )}

      {mode === 'scan' && <QrScanner onCode={onScanned} />}

      {mode === 'code' && (
        <div className="stack">
          <label className="field">
            <span>Код подключения (Настройки → Подключить устройство на другом устройстве)</span>
            <textarea rows={4} value={code} onChange={(e) => setCode(e.target.value)} placeholder="DR1:…" />
          </label>
          <button className="chunky c-peach wide" disabled={busy} onClick={() => void run(() => connectWithCode(code))}>
            {busy ? 'Подключаю…' : 'Подключить'}
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {mode !== 'choose' && (
        <button className="link" onClick={() => setMode('choose')}>
          ‹ Другой способ
        </button>
      )}
    </div>
  );
}
