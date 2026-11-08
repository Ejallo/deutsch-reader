import { useEffect, useRef, useState } from 'react';
import { startCall, type LiveCall } from '../lib/live';
import { chatHints, translateParagraph } from '../lib/gemini';
import { questEvent } from '../lib/quests';
import { getData } from '../lib/store';
import { shuffle } from '../lib/feed';
import { DialogSummary } from './DialogSummary';

// A free voice dialog over Gemini Live: the partner speaks, the learner answers by voice.
// After the call the whole transcript is reviewed once and the findings go to the dictionary.

const MAX_SECONDS = 14 * 60; // Live sessions end around 15 minutes; finish cleanly before that
const SUBS_KEY = 'callSubs';
const LEVEL_KEY = 'chatLevel';
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const WORDS_IN_PROMPT = 8;
const VOICE = 'Aoede';
const SLOWER = 'Bitte wiederhole das langsamer und mit einfacheren Wörtern.';
const OPENER = 'Beginne jetzt das Gespräch mit einem kurzen ersten Satz und einer einfachen Frage.';
const SCENE = 'A free everyday conversation with a friendly German speaker.';

interface Line {
  id: number;
  role: 'ai' | 'me';
  de: string;
  ru?: string;
  showRu?: boolean;
  open: boolean;
}

function savedLevel() {
  try {
    return localStorage.getItem(LEVEL_KEY) ?? 'A2';
  } catch {
    return 'A2';
  }
}

/** Words the partner should weave in: a few of the ones being learned, the most forgotten first. */
function studyWords(): string[] {
  const learning = Object.values(getData().words).filter((w) => !w.deleted && w.status === 'learning');
  const hard = [...learning].sort((a, b) => (b.card?.lapses ?? 0) - (a.card?.lapses ?? 0)).slice(0, 4);
  const rest = shuffle(learning.filter((w) => !hard.includes(w))).slice(0, WORDS_IN_PROMPT - hard.length);
  return [...hard, ...rest].map((w) => (w.article ? `${w.article} ${w.lemma}` : w.lemma));
}

function savedSubs() {
  try {
    return localStorage.getItem(SUBS_KEY) === '1';
  } catch {
    return false;
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VoiceCall({ onBack }: { onBack: () => void }) {
  const [level, setLevel] = useState(savedLevel);
  const [phase, setPhase] = useState<'ready' | 'connecting' | 'live' | 'ended'>('ready');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [subs, setSubs] = useState(savedSubs);
  const [seconds, setSeconds] = useState(0);
  const [warning, setWarning] = useState('');
  const [hints, setHints] = useState<string[] | null>(null);
  const [hinting, setHinting] = useState(false);
  const call = useRef<LiveCall | null>(null);
  const linesRef = useRef<Line[]>([]);
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const hasKey = !!getData().settings.geminiKey;

  useEffect(() => () => call.current?.hangUp(), []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, subs]);

  // Call timer, with a clean finish before the session limit
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) call.current?.hangUp();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  const commit = (next: Line[]) => {
    linesRef.current = next;
    setLines(next);
  };
  const patch = (id: number, p: Partial<Line>) => commit(linesRef.current.map((l) => (l.id === id ? { ...l, ...p } : l)));

  /** Streamed transcript pieces join the open line of that speaker; a finished turn closes it. */
  const onTranscript = (who: 'me' | 'ai', text: string, done: boolean) => {
    const cur = linesRef.current;
    if (done) {
      const closing = cur.filter((l) => l.open && l.role === who);
      if (!closing.length) return;
      // A learner line too short to judge (a cough, "äh") is dropped
      const next = cur
        .map((l) => (l.open && l.role === who ? { ...l, de: l.de.trim(), open: false } : l))
        .filter((l) => !(l.role === 'me' && closing.some((c) => c.id === l.id) && l.de.length < 2));
      commit(next);
      return;
    }
    if (!text) return;
    const open = cur.find((l) => l.open && l.role === who);
    if (open) commit(cur.map((l) => (l === open ? { ...l, de: l.de + text } : l)));
    else commit([...cur, { id: ++seq.current, role: who, de: text, open: true }]);
    if (who === 'me') setHints(null);
  };

  const start = async () => {
    setPhase('connecting');
    setError('');
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      // the level is just asked again next time
    }
    const words = studyWords();
    const system =
      `You are a friendly German speaker on a voice call with a Russian speaker learning German at CEFR level ${level}. ` +
      `Chat freely about everyday life, plans and whatever the learner brings up. ` +
      `Speak German, slowly and clearly, in short turns of 1-2 sentences, and keep the conversation going with a question. ` +
      `Do not correct the learner and do not explain grammar - just react naturally, like a patient native speaker. ` +
      `If they ask you to repeat or to speak slower, do it with simpler words. ` +
      `If the learner says something in Russian or asks how to say something, say the German word or phrase clearly, use it in one short sentence, then carry on in German. ` +
      `If the learner asks what a German word means, give the Russian translation in one or two words, then carry on in German. ` +
      (words.length ? `When it fits naturally, use some of these words the learner is studying: ${words.join(', ')}.` : '');
    try {
      call.current = await startCall(
        { system, opener: OPENER, voice: VOICE },
        {
          onStatus: setStatus,
          onTranscript,
          onLevel: setMicLevel,
          onSpeaking: setSpeaking,
          onWarning: (left) => setWarning(`Связь закончится примерно через ${left} с`),
          onClose: () => {
            call.current = null;
            // Lines still open when the call ends are closed so they get checked too
            onTranscript('me', '', true);
            onTranscript('ai', '', true);
            setPhase('ended');
          },
        },
      );
      setPhase('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('ready');
    }
  };

  // Minutes spoken count for the "talk 3 minutes" quest once the call is over
  useEffect(() => {
    if (phase === 'ended' && seconds >= 60) questEvent('callMinutes', Math.floor(seconds / 60));
  }, [phase]);

  const askHints = async () => {
    setHinting(true);
    try {
      setHints(await chatHints(SCENE, level, linesRef.current.map((l) => ({ role: l.role, de: l.de }))));
    } catch {
      setHints([]);
    } finally {
      setHinting(false);
    }
  };

  const translate = async (l: Line) => {
    if (l.ru) return patch(l.id, { showRu: !l.showRu });
    try {
      patch(l.id, { ru: await translateParagraph(l.de), showRu: true });
    } catch {
      // no translation: the line just stays German
    }
  };

  if (phase === 'ended') return <DialogSummary lines={lines.map((l) => ({ role: l.role, de: l.de }))} level={level} seconds={seconds} onBack={onBack} />;

  const listening = phase === 'live' && !speaking && !muted && micLevel > 0.02;
  return (
    <div className="feed call">
      <header className="feed-top">
        <button className="feed-close" onClick={() => (call.current ? call.current.hangUp() : onBack())} aria-label="Закрыть">
          ✕
        </button>
        <div className="chat-title">
          Диалог с ИИ <small>· {level}</small>
        </div>
        {phase === 'live' && <span className="pill call-clock">{clock(seconds)}</span>}
      </header>

      <div className="call-stage">
        <div className={`persona ${speaking ? 'speaking' : ''} ${listening ? 'listening' : ''}`} style={{ ['--lvl' as string]: Math.min(1, micLevel * 5) }}>
          <span>🗣️</span>
        </div>
        <div className="call-status">
          {phase === 'ready'
            ? hasKey
              ? 'Позвони — собеседник начнёт сам'
              : 'Нужен ключ Gemini — добавь его в настройках'
            : phase === 'connecting'
              ? status || 'Соединяю…'
              : speaking
                ? 'Говорит…'
                : muted
                  ? 'Микрофон выключен'
                  : 'Слушаю тебя'}
        </div>
        {phase === 'ready' && (
          <div className="segment call-level">
            {LEVELS.map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
        )}
        {warning && <div className="call-warning">{warning}</div>}
        {error && <pre className="live-error">{error}</pre>}

        {subs && lines.length > 0 && (
          <div className="call-subs">
            {lines.map((l) => (
              <div key={l.id} className={`live-line ${l.role}`} onClick={() => l.role === 'ai' && void translate(l)}>
                {l.de}
                {l.showRu && l.ru && <div className="sub-ru">{l.ru}</div>}
              </div>
            ))}
            <div ref={end} />
          </div>
        )}

        {hints && (
          <div className="chat-hints call-hints">
            {hints.length ? hints.map((h) => <div key={h}>💡 {h}</div>) : <div>Подсказка не пришла — попробуй ещё раз</div>}
          </div>
        )}
      </div>

      <div className="call-controls">
        {phase === 'live' ? (
          <>
            <div className="call-row">
              <button className="call-btn" onClick={() => call.current?.sendText(SLOWER)}>
                🐢<span>Медленнее</span>
              </button>
              <button className="call-btn" disabled={hinting} onClick={() => void askHints()}>
                💡<span>{hinting ? '…' : 'Подсказка'}</span>
              </button>
              <button
                className={`call-btn ${subs ? 'on' : ''}`}
                onClick={() => {
                  setSubs(!subs);
                  try {
                    localStorage.setItem(SUBS_KEY, subs ? '0' : '1');
                  } catch {
                    // the choice just isn't remembered
                  }
                }}
              >
                💬<span>Субтитры</span>
              </button>
              <button
                className={`call-btn ${muted ? 'on' : ''}`}
                onClick={() => {
                  call.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? '🔇' : '🎙'}
                <span>{muted ? 'Выкл.' : 'Микрофон'}</span>
              </button>
            </div>
            <button className="chunky c-pink call-end" onClick={() => call.current?.hangUp()}>
              Завершить звонок
            </button>
          </>
        ) : (
          <button className="chunky c-mint call-end" disabled={phase === 'connecting' || !hasKey} onClick={() => void start()}>
            {phase === 'connecting' ? 'Соединяю…' : '📞 Позвонить'}
          </button>
        )}
      </div>
    </div>
  );
}
