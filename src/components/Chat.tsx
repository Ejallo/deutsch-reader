import { useEffect, useRef, useState } from 'react';
import { addXp, getData, saveChunk } from '../lib/store';
import { chatCheck, chatReply, makeChunk, type ChatCheck, type ChatLine } from '../lib/gemini';
import { questEvent } from '../lib/quests';
import { sfx } from '../lib/sfx';
import { speak } from '../lib/tts';
import { shuffle } from '../lib/feed';
import { TopBar } from './ui';
import { VoiceCall } from './VoiceCall';

// Role-play conversations with Gemini: a quick partner plus a strict corrector for every learner line.
// Lives in the «Тестовое» lab while it is being tried out.

export interface Scene {
  id: string;
  emoji: string;
  title: string;
  /** What the model plays, in English for the prompt. */
  role: string;
  /** Prebuilt Live voice that suits the role. */
  voice?: string;
}

const SCENES: Scene[] = [
  { id: 'arzt', emoji: '🩺', title: 'У врача', role: 'You are a friendly doctor (Ärztin) in a German practice; the learner is a patient who came with a health problem.', voice: 'Kore' },
  { id: 'amt', emoji: '🏛', title: 'В ведомстве', role: 'You are an official at the Bürgeramt; the learner wants to register their new address (Anmeldung) and has questions about documents.', voice: 'Charon' },
  { id: 'wohnung', emoji: '🏠', title: 'Снять квартиру', role: 'You are a landlord showing a flat (Wohnungsbesichtigung); the learner is interested in renting it and asks about rent, deposit and the flat.', voice: 'Puck' },
  { id: 'cafe', emoji: '☕', title: 'В кафе', role: 'You are a waiter in a café; the learner orders food and drinks and pays.', voice: 'Puck' },
  { id: 'smalltalk', emoji: '💬', title: 'Small talk', role: 'You are a friendly new neighbour meeting the learner in the stairwell; chat about everyday life, work and hobbies.', voice: 'Aoede' },
  { id: 'job', emoji: '💼', title: 'Собеседование', role: 'You are an HR manager interviewing the learner for a job; ask about experience, strengths and plans.', voice: 'Kore' },
  { id: 'shop', emoji: '🛒', title: 'В магазине', role: 'You are a shop assistant in a clothing store; the learner is looking for something, asks about sizes and prices.', voice: 'Aoede' },
  { id: 'phone', emoji: '📞', title: 'Звонок: запись', role: 'You are a receptionist answering the phone; the learner calls to make an appointment (Termin) and agree on a date and time.', voice: 'Kore' },
];

const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const LEVEL_KEY = 'chatLevel';
const MODE_KEY = 'chatMode';
const WORDS_IN_PROMPT = 8;
const XP_PER_LINE = 5;
const XP_CAP = 100;

type Check = ChatCheck | 'pending' | 'error';
export interface Msg {
  id: number;
  role: 'ai' | 'me';
  de: string;
  ru?: string;
  showRu?: boolean;
  check?: Check;
}

function savedLevel() {
  try {
    return localStorage.getItem(LEVEL_KEY) ?? 'A2';
  } catch {
    return 'A2';
  }
}

function savedMode(): 'voice' | 'text' {
  try {
    return localStorage.getItem(MODE_KEY) === 'text' ? 'text' : 'voice';
  } catch {
    return 'voice';
  }
}

export const sceneText = (s: Scene) => `${s.role} (${s.title})`;

/** Words the partner should weave in: a few of the ones being learned, the most forgotten first. */
export function studyWords(): string[] {
  const learning = Object.values(getData().words).filter((w) => !w.deleted && w.status === 'learning');
  const hard = [...learning].sort((a, b) => (b.card?.lapses ?? 0) - (a.card?.lapses ?? 0)).slice(0, 4);
  const rest = shuffle(learning.filter((w) => !hard.includes(w))).slice(0, WORDS_IN_PROMPT - hard.length);
  return [...hard, ...rest].map((w) => (w.article ? `${w.article} ${w.lemma}` : w.lemma));
}

export function Lab({ onBack, onOpen }: { onBack: () => void; onOpen: (id: 'chat' | 'live') => void }) {
  return (
    <div className="screen">
      <TopBar title="🧪 Тестовое" back="Главная" onBack={onBack} />
      <p className="muted" style={{ fontWeight: 600 }}>
        Новые функции на обкатке. Они могут меняться или исчезнуть — расскажи, что понравилось.
      </p>
      <button className="lab-item" onClick={() => onOpen('chat')}>
        <span className="lab-ic">💬</span>
        <div>
          <b>Разговор с ИИ</b>
          <span>Ролевые сценки: врач, ведомство, квартира, small talk. Собеседник подстраивается под уровень, ошибки — в чанки.</span>
        </div>
      </button>
      <button className="lab-item c-mint-item" onClick={() => onOpen('live')}>
        <span className="lab-ic">📞</span>
        <div>
          <b>Проверка связи: голосом</b>
          <span>Живой голосовой разговор с Gemini Live. Проверяем, работает ли на твоём ключе и хорошо ли слышно на телефоне.</span>
        </div>
      </button>
    </div>
  );
}

export function Chat({ onBack }: { onBack: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [custom, setCustom] = useState('');
  const [level, setLevel] = useState(savedLevel);
  const [mode, setMode] = useState(savedMode);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const [showHints, setShowHints] = useState(false);
  const [done, setDone] = useState(false);
  const words = useRef<string[]>([]);
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const hasKey = !!getData().settings.geminiKey;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  /** Asks the partner for the next line, given the conversation so far. */
  const partner = async (s: Scene, history: Msg[]) => {
    setBusy(true);
    setError('');
    try {
      const lines: ChatLine[] = history.map((m) => ({ role: m.role, de: m.de }));
      const r = await chatReply(sceneText(s), level, words.current, lines);
      setMsgs((m) => [...m, { id: ++seq.current, role: 'ai', de: r.reply, ru: r.translation }]);
      setHints(r.hints ?? []);
      setShowHints(false);
      if (getData().settings.listening) speak(r.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  const start = (s: Scene) => {
    try {
      localStorage.setItem(LEVEL_KEY, level);
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // level and mode are just asked again next time
    }
    words.current = studyWords();
    setScene(s);
    if (mode === 'text') void partner(s, []);
  };

  const send = (text = input) => {
    const line = text.trim();
    if (!line || busy || !scene) return;
    const lastAi = [...msgs].reverse().find((m) => m.role === 'ai')?.de ?? '';
    const mine: Msg = { id: ++seq.current, role: 'me', de: line, check: 'pending' };
    const history = [...msgs, mine];
    setMsgs(history);
    setInput('');
    sfx.swipe();
    // The correction comes from a slower, stricter model, so it lands under the line on its own time
    chatCheck(lastAi, line, level)
      .then((c) => {
        setMsgs((m) => m.map((x) => (x.id === mine.id ? { ...x, check: c } : x)));
        if (c.ok) sfx.correct(1);
      })
      .catch(() => setMsgs((m) => m.map((x) => (x.id === mine.id ? { ...x, check: 'error' } : x))));
    void partner(scene, history);
  };

  if (!scene)
    return (
      <div className="screen">
        <TopBar title="💬 Разговор" back="Тестовое" onBack={onBack} />
        {!hasKey && <p className="muted">Для разговора нужен ключ Gemini — добавь его в настройках.</p>}
        <div className="overline" style={{ marginTop: 6 }}>
          Уровень
        </div>
        <div className="segment">
          {LEVELS.map((l) => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="overline" style={{ marginTop: 16 }}>
          Как говорим
        </div>
        <div className="segment">
          <button className={mode === 'voice' ? 'on' : ''} onClick={() => setMode('voice')}>
            📞 Голосом
          </button>
          <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
            💬 Текстом
          </button>
        </div>
        <div className="overline" style={{ marginTop: 16 }}>
          Сценка
        </div>
        <div className="scene-grid">
          {SCENES.map((s) => (
            <button key={s.id} className="scene" disabled={!hasKey} onClick={() => start(s)}>
              <span>{s.emoji}</span>
              <b>{s.title}</b>
            </button>
          ))}
        </div>
        <div className="custom-scene">
          <input className="input" placeholder="Своя сценка: например, «на вокзале, поезд отменили»" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button
            className="chunky c-peach"
            disabled={!hasKey || !custom.trim()}
            onClick={() => start({ id: 'custom', emoji: '✍️', title: custom.trim(), role: `Play the other person in this situation described by the learner (in Russian): "${custom.trim()}".` })}
          >
            Начать
          </button>
        </div>
      </div>
    );

  if (mode === 'voice') return <VoiceCall scene={scene} level={level} words={words.current} onBack={onBack} />;
  if (done) return <ChatSummary scene={scene} msgs={msgs} onBack={onBack} />;

  const mine = msgs.filter((m) => m.role === 'me');
  return (
    <div className="feed chat">
      <header className="feed-top">
        <button className="feed-close" onClick={() => (mine.length ? setDone(true) : onBack())} aria-label="Закрыть">
          ✕
        </button>
        <div className="chat-title">
          {scene.emoji} {scene.title} <small>· {level}</small>
        </div>
        {mine.length > 0 && (
          <button className="pill chat-finish" onClick={() => setDone(true)}>
            Завершить
          </button>
        )}
      </header>
      <div className="chat-log">
        {msgs.map((m) =>
          m.role === 'ai' ? (
            <div key={m.id} className="bubble ai" onClick={() => setMsgs((all) => all.map((x) => (x.id === m.id ? { ...x, showRu: !x.showRu } : x)))}>
              <div className="de">{m.de}</div>
              {m.showRu ? <div className="ru">{m.ru}</div> : <div className="tap">нажми — перевод</div>}
              <button
                className="bubble-say"
                onClick={(e) => {
                  e.stopPropagation();
                  speak(m.de);
                }}
                aria-label="Озвучить"
              >
                🔊
              </button>
            </div>
          ) : (
            <div key={m.id} className="bubble-me-wrap">
              <div className="bubble me">{m.de}</div>
              <CheckNote check={m.check} />
            </div>
          ),
        )}
        {busy && <div className="bubble ai typing">…</div>}
        {error && (
          <div className="chat-error">
            {error}{' '}
            <button className="link" onClick={() => void partner(scene, msgs)}>
              Повторить
            </button>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-input">
        {showHints && hints.length > 0 && (
          <div className="chat-hints">
            {hints.map((h) => (
              <button key={h} onClick={() => setInput(h)}>
                {h}
              </button>
            ))}
          </div>
        )}
        <div className="chat-row">
          <button className="sq-btn" onClick={() => setShowHints(!showHints)} disabled={!hints.length} aria-label="Подсказка">
            💡
          </button>
          <textarea
            className="input"
            rows={1}
            placeholder="Пиши или надиктуй 🎤 с клавиатуры"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="chunky c-peach chat-send" disabled={busy || !input.trim()} onClick={() => send()}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckNote({ check }: { check?: Check }) {
  if (!check) return null;
  if (check === 'pending') return <div className="chat-check pending">проверяю…</div>;
  if (check === 'error') return <div className="chat-check">не удалось проверить</div>;
  if (check.ok) return <div className="chat-check ok">✓ без ошибок</div>;
  return (
    <div className="chat-check fix">
      <div>
        🖊 <b>{check.corrected}</b>
      </div>
      {check.issues.map((i, n) => (
        <div key={n} className="issue">
          <s>{i.wrong}</s> → <b>{i.right}</b> — {i.explanation}
        </div>
      ))}
    </div>
  );
}

/** End of the conversation: how it went, and the corrected lines to keep as chunks. */
export function ChatSummary({ scene, msgs, seconds, onBack }: { scene: Scene; msgs: Msg[]; seconds?: number; onBack: () => void }) {
  const mine = msgs.filter((m) => m.role === 'me');
  const checked = mine.filter((m) => m.check && typeof m.check === 'object') as (Msg & { check: ChatCheck })[];
  const pending = mine.filter((m) => m.check === 'pending').length;
  const fixes = checked.filter((m) => !m.check.ok);
  const clean = checked.length - fixes.length;
  // Checks can still arrive after the call ends, so the learner's un-ticks are kept rather than the ticks
  const [unpicked, setUnpicked] = useState<Set<number>>(new Set());
  const picked = new Set(fixes.filter((m) => !unpicked.has(m.id)).map((m) => m.id));
  const [saving, setSaving] = useState<string>('');
  const [saved, setSaved] = useState(0);
  const [xp, setXp] = useState(0);
  const paid = useRef(false);

  // Paid once on arrival (the ref also survives StrictMode's double effect run)
  useEffect(() => {
    if (paid.current) return;
    paid.current = true;
    const got = addXp(Math.min(XP_CAP, mine.length * XP_PER_LINE));
    questEvent('xp', got);
    sfx.fanfare();
    setXp(got);
  }, []);

  const toChunks = async () => {
    const chosen = fixes.filter((m) => picked.has(m.id));
    let n = 0;
    for (const m of chosen) {
      setSaving(`Делаю чанки… ${n + 1} / ${chosen.length}`);
      // The first fixed fragment is what the learner got wrong: the chunk is built around it
      const hint = m.check.issues[0]?.right || m.check.corrected;
      try {
        const info = await makeChunk(hint, m.check.corrected);
        saveChunk({ ...info, status: 'learning', source: `Разговор: ${scene.title}` });
        n++;
      } catch {
        // a phrase Gemini couldn't turn into a chunk is skipped
      }
    }
    setSaved(n);
    setSaving('');
  };

  return (
    <div className="screen chat-summary">
      <TopBar title="Итог разговора" back="Тестовое" onBack={onBack} />
      <div className="stat-tiles">
        {seconds !== undefined && (
          <div className="c-sky">
            <b>
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </b>
            <span>время</span>
          </div>
        )}
        <div className="c-lav">
          <b>{mine.length}</b>
          <span>реплик</span>
        </div>
        <div className="c-mint">
          <b>{clean}</b>
          <span>без ошибок</span>
        </div>
        <div className="c-butter">
          <b>+{xp}</b>
          <span>XP</span>
        </div>
      </div>
      {fixes.length ? (
        <>
          <div className="overline" style={{ marginTop: 20 }}>
            Твои ошибки — отметь, что сделать чанками
          </div>
          {fixes.map((m) => (
            <label key={m.id} className="fix-row">
              <input
                type="checkbox"
                checked={picked.has(m.id)}
                onChange={() =>
                  setUnpicked((u) => {
                    const next = new Set(u);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
              />
              <div>
                <s>{m.de}</s>
                <b>{m.check.corrected}</b>
                {m.check.issues.map((i, n) => (
                  <small key={n}>{i.explanation}</small>
                ))}
              </div>
            </label>
          ))}
          {pending > 0 && (
            <p className="muted small" style={{ fontWeight: 600 }}>
              Проверяю ещё {pending}…
            </p>
          )}
          {saved ? (
            <p className="muted" style={{ fontWeight: 700 }}>
              ✓ Добавлено чанков: {saved}. Они уже в ленте.
            </p>
          ) : (
            <button className="chunky c-peach" style={{ width: '100%', marginTop: 12 }} disabled={!!saving || !picked.size} onClick={() => void toChunks()}>
              {saving || `🧩 Добавить в чанки (${picked.size})`}
            </button>
          )}
        </>
      ) : (
        <p className="muted" style={{ fontWeight: 600, marginTop: 20 }}>
          {pending ? `Проверяю твои фразы… ещё ${pending}` : checked.length ? 'Ни одной ошибки — отлично!' : 'Нечего проверять.'}
        </p>
      )}
      <button className="link" style={{ marginTop: 16 }} onClick={onBack}>
        Готово
      </button>
    </div>
  );
}
