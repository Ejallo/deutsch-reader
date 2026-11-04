import { useEffect, useRef, useState } from 'react';
import { getData } from '../lib/store';
import { startCall, type LiveCall } from '../lib/live';
import { Mascot, TopBar } from './ui';

// A short test call before building voice role-play on top: does Live work on this key, is it loud enough
// on the phone, does it understand spoken German.

const SYSTEM =
  'You are a friendly German conversation partner for a Russian speaker learning German at level A2. ' +
  'Speak only German, slowly and clearly, in short sentences (1-2 per turn). Ask simple questions about their day. ' +
  'If they speak Russian, answer in simple German anyway.';
const OPENER = 'Begrüße mich kurz auf Deutsch und frag, wie es mir geht.';

type Line = { who: 'me' | 'ai'; text: string; open: boolean };

export function LiveTest({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [call, setCall] = useState<LiveCall | null>(null);
  const [starting, setStarting] = useState(false);
  const callRef = useRef<LiveCall | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const hasKey = !!getData().settings.geminiKey;

  useEffect(() => () => callRef.current?.hangUp(), []);
  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would take for a cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  /** Appends a streamed transcript piece to the open line of that speaker, or starts a new one. */
  const addText = (who: 'me' | 'ai', text: string, done: boolean) =>
    setLines((all) => {
      const i = all.map((l) => l.who === who && l.open).lastIndexOf(true);
      if (done) return i < 0 ? all : all.map((l, k) => (k === i ? { ...l, open: false } : l));
      if (!text) return all;
      if (i >= 0) return all.map((l, k) => (k === i ? { ...l, text: l.text + text } : l));
      return [...all, { who, text, open: true }];
    });

  const start = async () => {
    setError('');
    setLines([]);
    setStarting(true);
    try {
      const c = await startCall(SYSTEM, OPENER, {
        onStatus: setStatus,
        onTranscript: addText,
        onLevel: setLevel,
        onSpeaking: setSpeaking,
        onClose: (reason) => {
          setStatus(reason);
          setCall(null);
          callRef.current = null;
          setLevel(0);
        },
      });
      callRef.current = c;
      setCall(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="screen live-test">
      <TopBar title="📞 Проверка связи" back="Тестовое" onBack={onBack} />
      <p className="muted" style={{ fontWeight: 600 }}>
        Голосовой разговор с Gemini Live. Нажми «Позвонить», дождись приветствия и ответь голосом по-немецки — например «Mir geht's gut, danke!». Проверяем: отвечает ли, хорошо ли слышно, понимает ли тебя.
      </p>

      <div className={`live-stage ${speaking ? 'speaking' : ''}`}>
        <Mascot size={120} mood={speaking ? 'happy' : 'wait'} />
        <div className="live-meter">
          <i style={{ width: `${Math.min(100, level * 400)}%` }} />
        </div>
        <div className="live-status">{status || (hasKey ? 'Готов к звонку' : 'Нужен ключ Gemini')}</div>
      </div>

      {error && <pre className="live-error">{error}</pre>}

      {call ? (
        <div className="live-actions">
          <button
            className={`chunky ${muted ? 'c-butter' : 'c-card'}`}
            onClick={() => {
              call.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? '🔇 Микрофон выкл.' : '🎙 Микрофон вкл.'}
          </button>
          <button className="chunky c-pink" onClick={() => call.hangUp()}>
            Завершить
          </button>
        </div>
      ) : (
        <button className="chunky c-mint live-call" disabled={!hasKey || starting} onClick={() => void start()}>
          {starting ? 'Соединяю…' : '📞 Позвонить'}
        </button>
      )}

      {lines.length > 0 && (
        <div className="live-lines">
          {lines.map((l, i) => (
            <div key={i} className={`live-line ${l.who}`}>
              <b>{l.who === 'me' ? 'Ты' : 'ИИ'}:</b> {l.text}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
