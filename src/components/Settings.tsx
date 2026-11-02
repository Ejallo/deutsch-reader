import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { getData, importData, updateSettings, useData, type AppData } from '../lib/store';
import { listModels, pickDefaultModel, type ModelInfo } from '../lib/gemini';
import { connectionCode, disconnect, getConnection, syncNow, useSync } from '../lib/sync';
import { Setup } from './Setup';

interface Props {
  onBack: () => void;
}

export function Settings({ onBack }: Props) {
  return (
    <div className="screen">
      <header className="bar">
        <button className="link" onClick={onBack}>
          ‹ Назад
        </button>
        <h1>Настройки</h1>
        <span />
      </header>
      <GeminiSection />
      <LearnSection />
      <SyncSection />
      <DataSection />
    </div>
  );
}

function GeminiSection() {
  const { settings } = useData();
  const [key, setKey] = useState(settings.geminiKey);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setKey(settings.geminiKey), [settings.geminiKey]);

  const save = async () => {
    setError('');
    setMsg('Проверяю ключ…');
    try {
      const list = await listModels(key.trim());
      setModels(list);
      const model = settings.geminiModel && list.some((m) => m.name === settings.geminiModel) ? settings.geminiModel : pickDefaultModel(list);
      updateSettings({ geminiKey: key.trim(), geminiModel: model });
      setMsg('Ключ работает');
    } catch (e) {
      setMsg('');
      setError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <h2>Перевод (Gemini)</h2>
      <label className="field">
        <span>Ключ API из Google AI Studio</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" />
      </label>
      <button className="primary" onClick={() => void save()}>
        Сохранить и проверить
      </button>
      {models.length > 0 && (
        <label className="field">
          <span>Модель</span>
          <select value={settings.geminiModel} onChange={(e) => updateSettings({ geminiModel: e.target.value })}>
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {settings.geminiModel && !models.length && <p className="muted small">Модель: {settings.geminiModel.replace('models/', '')}</p>}
      {msg && <p className="small">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function LearnSection() {
  const { settings } = useData();
  return (
    <section className="card">
      <h2>Заучивание</h2>
      <label className="field">
        <span>Новых слов в день</span>
        <select value={settings.newPerDay} onChange={(e) => updateSettings({ newPerDay: Number(e.target.value) })}>
          {[5, 10, 15, 20, 30].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
        <span>Звуки в ленте</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.listening} onChange={(e) => updateSettings({ listening: e.target.checked })} />
        <span>Аудирование: карточки «послушай» и автоозвучка слов</span>
      </label>
    </section>
  );
}

function SyncSection() {
  const sync = useSync();
  const conn = getConnection();
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  if (sync.status === 'off' || !conn) {
    return (
      <section className="card">
        <h2>Синхронизация</h2>
        <p className="muted small">Не подключена: данные есть только на этом устройстве.</p>
        <Setup embedded onDone={() => undefined} />
      </section>
    );
  }

  const showQr = async () => {
    const c = connectionCode(conn);
    setCode(c);
    // Low error correction keeps the code less dense, which phone cameras read more easily
    setQr(await QRCode.toDataURL(c, { margin: 2, width: 360, errorCorrectionLevel: 'L' }));
  };

  return (
    <section className="card">
      <h2>Синхронизация</h2>
      <p className="small">
        Репозиторий: {conn.owner}/{conn.repo}
      </p>
      <p className={sync.status === 'error' ? 'error small' : 'muted small'}>
        {sync.status === 'syncing'
          ? 'Синхронизация…'
          : sync.status === 'error'
            ? sync.error
            : sync.lastSync
              ? `Последняя синхронизация: ${new Date(sync.lastSync).toLocaleTimeString('ru-RU')}`
              : 'Готово'}
      </p>
      <div className="row">
        <button onClick={() => void syncNow()}>Синхронизировать</button>
        <button onClick={() => (qr ? setQr('') : void showQr())}>{qr ? 'Скрыть QR' : 'Подключить устройство'}</button>
      </div>
      {qr && (
        <div className="qr">
          <p className="small">На втором устройстве: Настройки или первый экран → «Сканировать QR». В коде токен GitHub — не показывай его другим.</p>
          <img src={qr} alt="QR-код подключения" width={360} height={360} />
          <button
            className="link"
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => setCopied(true));
            }}
          >
            {copied ? 'Код скопирован' : 'Скопировать код текстом'}
          </button>
        </div>
      )}
      <button
        className="link danger"
        onClick={() => {
          if (confirm('Отключить синхронизацию на этом устройстве? Данные на устройстве и в GitHub останутся.')) void disconnect();
        }}
      >
        Отключить это устройство
      </button>
    </section>
  );
}

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const exportData = () => {
    // The Gemini key stays out of exported files
    const d: AppData = { ...getData(), settings: { ...getData().settings, geminiKey: '' } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `deutsch-reader-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as AppData;
      if (d.version !== 1 || !d.words || !d.texts) throw new Error();
      // Never let an exported (empty) key overwrite the real one
      importData({ ...d, settings: { ...d.settings, updatedAt: 0 } });
      setMsg('Импортировано');
    } catch {
      setMsg('Это не файл Deutsch Reader');
    }
  };

  return (
    <section className="card">
      <h2>Резервная копия</h2>
      <p className="muted small">Запасной вариант: основная копия — в GitHub.</p>
      <div className="row">
        <button onClick={exportData}>Экспорт в файл</button>
        <button onClick={() => fileRef.current?.click()}>Импорт из файла</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
