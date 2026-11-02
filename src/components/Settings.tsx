import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { getData, importData, updateSettings, useData, type AppData } from '../lib/store';
import { listModels, pickDefaultModel, type ModelInfo } from '../lib/gemini';
import { connectionCode, disconnect, getConnection, syncNow, useSync } from '../lib/sync';
import { Setup } from './Setup';
import type { Theme } from '../lib/theme';
import { disableReminders, enableReminders, isIos, isStandalone, pushDiagnostics, pushSupported, reminderPrefs, sendTestReminder } from '../lib/push';
import type { ReactNode } from 'react';
import { TabBar, type Tab } from './TabBar';
import { StatStrip, TopBar, type Accent } from './ui';

interface Props {
  onTab: (t: Tab) => void;
  onLearn: () => void;
}

export function Settings({ onTab, onLearn }: Props) {
  return (
    <div className="screen">
      <TopBar title="Настройки" right={<StatStrip />} />
      <ThemeSection />
      <LearnSection />
      <GeminiSection />
      <ReminderSection />
      <SyncSection />
      <DataSection />
      <p className="muted small" style={{ textAlign: 'center', marginTop: 20 }}>
        Версия {__BUILD__} UTC
      </p>
      <TabBar active="settings" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}

function Group({ title, children, flush }: { title: string; children: ReactNode; flush?: boolean }) {
  return (
    <section className="group">
      <div className="overline">{title}</div>
      <div className="group-card">{flush ? children : <div className="group-body">{children}</div>}</div>
    </section>
  );
}

function SetRow({ ic, accent, label, children }: { ic: string; accent: Accent; label: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className={`ic c-${accent}`}>{ic}</span>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
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
    <Group title="Перевод · Gemini">
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ключ AIza…" autoComplete="off" />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small" style={{ fontWeight: 600 }}>
          {settings.geminiModel ? `✓ ${settings.geminiModel.replace('models/', '')}` : 'Ключ не проверен'}
        </span>
        <button className="pill c-mint" onClick={() => void save()}>
          Проверить
        </button>
      </div>
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
      {msg && <p className="small">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </Group>
  );
}

function ThemeSection() {
  const { settings } = useData();
  const options: [Theme, string, string][] = [
    ['light', '☀', 'Светлая'],
    ['dark', '☾', 'Тёмная'],
    ['time', '◐', 'По времени'],
    ['auto', '▢', 'Как iOS'],
  ];
  return (
    <Group title="Тема" flush>
      <div className="theme-tiles">
        {options.map(([id, ic, label]) => (
          <button key={id} className={settings.theme === id ? 'on' : ''} onClick={() => updateSettings({ theme: id })}>
            <span className="ic">{ic}</span>
            {label}
          </button>
        ))}
      </div>
    </Group>
  );
}

function ReminderSection() {
  const [prefs, setPrefs] = useState(reminderPrefs());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      setPrefs(reminderPrefs());
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!pushSupported()) {
    return (
      <Group title="Напоминания">
        <p className="muted small" style={{ margin: 0 }}>
          {isIos() && !isStandalone()
            ? 'Напоминания работают только в приложении с экрана «Домой»: Safari → Поделиться → На экран Домой (iOS 16.4+).'
            : 'Напоминания пока недоступны на этом устройстве.'}
        </p>
        <p className="muted small">{pushDiagnostics()}</p>
      </Group>
    );
  }

  return (
    <Group title="Напоминания">
      <p className="muted small" style={{ margin: 0 }}>
        Пришлю уведомление в выбранный час, если цель дня ещё не выполнена.
      </p>
      <label className="field">
        <span>Во сколько напоминать</span>
        <select
          value={prefs.hour}
          disabled={busy}
          onChange={(e) => {
            const hour = Number(e.target.value);
            setPrefs({ ...prefs, hour });
            if (prefs.enabled) void run(() => enableReminders(hour, setMsg), 'Время изменено');
          }}
        >
          {Array.from({ length: 17 }, (_, i) => i + 7).map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        {prefs.enabled ? (
          <>
            <button disabled={busy} onClick={() => void run(disableReminders, 'Напоминания выключены')}>
              Выключить
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const status = await sendTestReminder();
                  if (status !== 201 && status !== 200) throw new Error(`Сервис уведомлений Apple ответил ${status}`);
                }, 'Тестовое отправлено — придёт в течение минуты')
              }
            >
              Прислать тестовое
            </button>
          </>
        ) : (
          <button className="chunky c-peach" disabled={busy} onClick={() => void run(() => enableReminders(prefs.hour, setMsg), 'Напоминания включены')}>
            Включить напоминания
          </button>
        )}
      </div>
      {msg && <p className="small">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <p className="muted small">{pushDiagnostics()}</p>
    </Group>
  );
}

function LearnSection() {
  const { settings } = useData();
  const step = (d: number) => updateSettings({ newPerDay: Math.min(30, Math.max(5, settings.newPerDay + d)) });
  return (
    <Group title="Заучивание" flush>
      <SetRow ic="🎯" accent="mint" label="Новых слов в день">
        <div className="stepper">
          <button onClick={() => step(-5)} aria-label="Меньше">
            −
          </button>
          {settings.newPerDay}
          <button onClick={() => step(5)} aria-label="Больше">
            +
          </button>
        </div>
      </SetRow>
      <SetRow ic="🔊" accent="sky" label="Звуки и конфетти">
        <Switch on={settings.sound} onChange={(v) => updateSettings({ sound: v })} label="Звуки" />
      </SetRow>
      <SetRow ic="🎧" accent="peach" label="Аудирование">
        <Switch on={settings.listening} onChange={(v) => updateSettings({ listening: v })} label="Аудирование" />
      </SetRow>
    </Group>
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
      <Group title="Синхронизация">
        <p className="muted small" style={{ margin: 0 }}>
          Не подключена: данные есть только на этом устройстве.
        </p>
        <Setup embedded onDone={() => undefined} />
      </Group>
    );
  }

  const statusLine = (
    <p className={sync.status === 'error' ? 'error small' : 'muted small'}>
      {sync.status === 'syncing'
        ? 'Синхронизация…'
        : sync.status === 'error'
          ? sync.error
          : sync.lastSync
            ? `Последняя синхронизация: ${new Date(sync.lastSync).toLocaleTimeString('ru-RU')}`
            : 'Готово'}
    </p>
  );

  if (conn.kind === 'cloud') {
    return (
      <Group title="Аккаунт">
        <p className="small" style={{ margin: 0, fontWeight: 700 }}>
          {conn.name || 'Вход через Google'}
        </p>
        {conn.email && (
          <p className="muted small" style={{ margin: 0 }}>
            {conn.email}
          </p>
        )}
        {statusLine}
        <div className="row">
          <button onClick={() => void syncNow()}>Синхронизировать</button>
        </div>
        <p className="muted small">На другом устройстве просто войди через тот же Google-аккаунт.</p>
        <button
          className="link danger"
          onClick={() => {
            if (confirm('Выйти из аккаунта на этом устройстве? Данные останутся на сервере и на устройстве.')) void disconnect();
          }}
        >
          Выйти
        </button>
      </Group>
    );
  }

  const gh = conn;
  const showQr = async () => {
    const c = connectionCode(gh);
    setCode(c);
    // Low error correction keeps the code less dense, which phone cameras read more easily
    setQr(await QRCode.toDataURL(c, { margin: 2, width: 360, errorCorrectionLevel: 'L' }));
  };

  return (
    <Group title="Синхронизация">
      <p className="small" style={{ margin: 0 }}>
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
    </Group>
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
    <Group title="Резервная копия">
      <p className="muted small" style={{ margin: 0 }}>
        Запасной вариант: основная копия — в GitHub.
      </p>
      <div className="row">
        <button onClick={exportData}>Экспорт в файл</button>
        <button onClick={() => fileRef.current?.click()}>Импорт из файла</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {msg && <p className="small">{msg}</p>}
    </Group>
  );
}
