import { useEffect, useRef, useState } from 'react';
import { startCall, type LiveCall } from '../lib/live';
import { chatCheck, chatHints, translateParagraph } from '../lib/gemini';
import { questEvent } from '../lib/quests';
import { ChatSummary, sceneText, type Msg, type Scene } from './Chat';

// A role-play phone call over Gemini Live: the partner speaks, the learner answers by voice.
// Corrections run quietly in the background on the transcripts and are shown only after the call.

const MAX_SECONDS = 14 * 60; // Live sessions end around 15 minutes; finish cleanly before that
const SUBS_KEY = 'callSubs';
const SLOWER = 'Bitte wiederhole das langsamer und mit einfacheren Wörtern.';
const OPENER = 'Beginne jetzt das Gespräch in deiner Rolle mit einem kurzen ersten Satz.';

type Line = Msg & { open: boolean };

function savedSubs() {
  try {
    return localStorage.getItem(SUBS_KEY) === '1';
  } catch {
    return false;
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VoiceCall({ scene, level, words, onBack }: { scene: Scene; level: string; words: string[]; onBack: () => void }) {
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

  /** Checks one finished learner line against what the partner had just said. */
  const check = (line: Line) => {
    const before = linesRef.current.filter((l) => l.role === 'ai' && l.id < line.id);
    const partnerLine = before[before.length - 1]?.de ?? '';
    chatCheck(partnerLine, line.de, level, true)
      .then((c) => patch(line.id, { check: c }))
      .catch(() => patch(line.id, { check: 'error' }));
  };

  /** Streamed transcript pieces join the open line of that speaker; a finished turn closes it. */
  const onTranscript = (who: 'me' | 'ai', text: string, done: boolean) => {
    const cur = linesRef.current;
    if (done) {
      const closing = cur.filter((l) => l.open && l.role === who);
      if (!closing.length) return;
      // A learner line too short to judge (a cough, "äh") is dropped
      const next = cur
        .map((l) => (l.open && l.role === who ? { ...l, de: l.de.trim(), open: false, check: who === 'me' ? ('pending' as const) : undefined } : l))
        .filter((l) => !(l.role === 'me' && closing.some((c) => c.id === l.id) && l.de.length < 2));
      commit(next);
      if (who === 'me') next.filter((l) => closing.some((c) => c.id === l.id)).forEach(check);
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
    const system =
      `${sceneText(scene)}\n` +
      `You are on a voice call with a Russian speaker learning German at CEFR level ${level}. Stay in your role the whole time. ` +
      `Speak only German, slowly and clearly, in short turns of 1-2 sentences, and keep the conversation going with a question. ` +
      `Do not correct the learner and do not explain grammar - just react naturally, like a patient native speaker. ` +
      `If they ask you to repeat or to speak slower, do it with simpler words. If they speak Russian, answer in simple German. ` +
      (words.length ? `When it fits naturally, use some of these words the learner is studying: ${words.join(', ')}.` : '');
    try {
      call.current = await startCall(
        { system, opener: OPENER, voice: scene.voice },
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
      setHints(await chatHints(sceneText(scene), level, linesRef.current.map((l) => ({ role: l.role, de: l.de }))));
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

  if (phase === 'ended') return <ChatSummary scene={scene} msgs={lines} seconds={seconds} onBack={onBack} />;

  const listening = phase === 'live' && !speaking && !muted && micLevel > 0.02;
  return (
    <div className="feed call">
      <header className="feed-top">
        <button className="feed-close" onClick={() => (call.current ? call.current.hangUp() : onBack())} aria-label="Закрыть">
          ✕
        </button>
        <div className="chat-title">
          {scene.title} <small>· {level}</small>
        </div>
        {phase === 'live' && <span className="pill call-clock">{clock(seconds)}</span>}
      </header>

      <div className="call-stage">
        <div className={`persona ${speaking ? 'speaking' : ''} ${listening ? 'listening' : ''}`} style={{ ['--lvl' as string]: Math.min(1, micLevel * 5) }}>
          <span>{scene.emoji}</span>
        </div>
        <div className="call-status">
          {phase === 'ready'
            ? 'Позвони — собеседник начнёт сам'
            : phase === 'connecting'
              ? status || 'Соединяю…'
              : speaking
                ? 'Говорит…'
                : muted
                  ? 'Микрофон выключен'
                  : 'Слушаю тебя'}
        </div>
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
          <button className="chunky c-mint call-end" disabled={phase === 'connecting'} onClick={() => void start()}>
            {phase === 'connecting' ? 'Соединяю…' : '📞 Позвонить'}
          </button>
        )}
      </div>
    </div>
  );
}
