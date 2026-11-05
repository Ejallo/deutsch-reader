import { useEffect, useMemo, useRef, useState } from 'react';
import { transcribeVideo, translateParagraph, translateWord, type VideoLine } from '../lib/gemini';
import { lemmaKey, linkForm, statusOf, useData } from '../lib/store';
import { parseText } from '../lib/text';
import { TopBar } from './ui';
import { WordSheet, type SheetState } from './WordSheet';

// Lab test: a YouTube video with German subtitles you can tap. Subtitles come from Gemini (it accepts public
// YouTube links) or from a pasted YouTube transcript. Transcripts are cached per video in localStorage.

interface Transcript {
  title: string;
  lines: VideoLine[];
  source: 'gemini' | 'paste';
}

const cacheKey = (id: string) => `video:${id}`;
const loadCached = (id: string): Transcript | null => {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null');
  } catch {
    return null;
  }
};

/** Video id from any usual YouTube link (watch, youtu.be, shorts, embed, live) or a bare id. */
export function videoIdOf(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** Parses a transcript copied from YouTube's "Show transcript" panel: a timestamp line, then the text. */
export function parsePasted(text: string): VideoLine[] {
  const lines: VideoLine[] = [];
  let cur: VideoLine | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    // Timestamp alone on a line, or at the start of the line ("0:05 Hallo zusammen")
    const m = row.match(/^(\d{1,2}(?::\d{2}){1,2})\s*(.*)$/);
    if (m) {
      if (cur?.de) lines.push(cur);
      const t = m[1].split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
      cur = { t, de: m[2] };
    } else if (cur) {
      cur.de = cur.de ? `${cur.de} ${row}` : row;
    }
  }
  if (cur?.de) lines.push(cur);
  return lines;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// --- Minimal YouTube IFrame API typing ---

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Не загрузился плеер YouTube'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const PLAYING = 1;

export function VideoTest({ onBack }: { onBack: () => void }) {
  const data = useData();
  const hasKey = !!data.settings.geminiKey;
  const [url, setUrl] = useState(() => localStorage.getItem('video:last') ?? '');
  const [id, setId] = useState<string | null>(null);
  const [tr, setTr] = useState<Transcript | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState<string | null>(null);

  const open = (raw: string) => {
    const vid = videoIdOf(raw);
    setError('');
    if (!vid) {
      setError('Не похоже на ссылку YouTube');
      return;
    }
    localStorage.setItem('video:last', raw.trim());
    setId(vid);
    setTr(loadCached(vid));
    setPaste(null);
  };

  const save = (t: Transcript) => {
    if (!id) return;
    localStorage.setItem(cacheKey(id), JSON.stringify(t));
    setTr(t);
  };

  const transcribe = async () => {
    if (!id) return;
    setBusy(true);
    setError('');
    setElapsed(0);
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const r = await transcribeVideo(`https://www.youtube.com/watch?v=${id}`);
      save({ title: r.title, lines: r.lines, source: 'gemini' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const applyPaste = () => {
    const lines = parsePasted(paste ?? '');
    if (lines.length < 2) {
      setError('Не нашёл таймкодов. Нужен текст из «Показать расшифровку» на YouTube: время, потом фраза.');
      return;
    }
    save({ title: 'Видео', lines, source: 'paste' });
    setPaste(null);
    setError('');
  };

  if (!id) {
    return (
      <div className="screen">
        <TopBar title="🎬 Видео с субтитрами" back="Тестовое" onBack={onBack} />
        <p className="muted" style={{ fontWeight: 600 }}>
          Вставь ссылку на видео YouTube на немецком. Субтитры можно нажимать — перевод, как в читалке.
        </p>
        <input placeholder="https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        <button className="chunky c-peach wide" style={{ marginTop: 12 }} onClick={() => open(url)} disabled={!url.trim()}>
          Открыть
        </button>
        {error && <p className="error">{error}</p>}
        <p className="muted small" style={{ marginTop: 18 }}>
          Для начала подойдут короткие ролики до 10–15 минут: Easy German, Nicos Weg (DW), Deutsch mit Marija.
        </p>
      </div>
    );
  }

  return (
    <div className="screen video-screen">
      <TopBar title={tr?.title ?? '🎬 Видео'} back="Ссылка" onBack={() => setId(null)} />
      <Player key={id} id={id} lines={tr?.lines ?? []} source={tr?.title}>
        {!tr && paste === null && (
          <div className="video-empty">
            {busy ? (
              <p className="muted" style={{ fontWeight: 700 }}>
                Gemini смотрит видео… {elapsed} с<br />
                <span className="small">Обычно 20–90 секунд, зависит от длины.</span>
              </p>
            ) : (
              <>
                <button className="chunky c-peach wide" onClick={() => void transcribe()} disabled={!hasKey}>
                  ✨ Сделать субтитры (Gemini)
                </button>
                {!hasKey && <p className="muted small">Нужен ключ Gemini в настройках.</p>}
                <button className="chunky c-card wide" onClick={() => setPaste('')}>
                  📋 Вставить расшифровку с YouTube
                </button>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {paste !== null && (
          <div className="video-empty">
            <p className="muted small">
              На YouTube под видео: «…ещё» → «Показать расшифровку» → выбери немецкий → выдели всё и скопируй сюда.
            </p>
            <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'0:00\nHallo zusammen!\n0:03\nHeute sind wir…'} />
            <button className="chunky c-peach wide" onClick={applyPaste}>
              Готово
            </button>
            <button className="link" onClick={() => setPaste(null)}>
              Отмена
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {tr && (
          <button
            className="link danger"
            onClick={() => {
              if (!confirm('Убрать эти субтитры и сделать заново?')) return;
              localStorage.removeItem(cacheKey(id));
              setTr(null);
            }}
          >
            Сбросить субтитры ({tr.source === 'gemini' ? 'Gemini' : 'вставка'})
          </button>
        )}
      </Player>
    </div>
  );
}

function Player({ id, lines, source, children }: { id: string; lines: VideoLine[]; source?: string; children: React.ReactNode }) {
  const data = useData();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offset, setOffset] = useState(() => Number(localStorage.getItem(`video:offset:${id}`) ?? 0));
  const [pauseEach, setPauseEach] = useState(false);
  const [showRu, setShowRu] = useState(false);
  const [ru, setRu] = useState<Record<number, string>>({});
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [follow, setFollow] = useState(true);
  const reqId = useRef(0);
  const lineEls = useRef<(HTMLDivElement | null)[]>([]);
  const pauseAt = useRef<number | null>(null);

  const parsed = useMemo(() => lines.map((l) => parseText(l.de)[0]), [lines]);

  // Index of the line being spoken now (subtitle times shifted by the user's offset)
  const active = useMemo(() => {
    let i = -1;
    for (let k = 0; k < lines.length; k++) if (lines[k].t + offset <= time + 0.15) i = k;
    return i;
  }, [lines, time, offset]);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    loadYouTubeApi()
      .then(() => {
        if (!alive || !host.current || !window.YT) return;
        player.current = new window.YT.Player(host.current, {
          videoId: id,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3 },
          events: {
            onReady: () => alive && setReady(true),
            onStateChange: (e: { data: number }) => alive && setPlaying(e.data === PLAYING),
            onError: () => alive && setError('YouTube не даёт встроить это видео — попробуй другое'),
          },
        });
        timer = window.setInterval(() => {
          const p = player.current;
          if (!p?.getCurrentTime) return;
          const t = p.getCurrentTime();
          setTime(t);
          if (pauseAt.current !== null && t >= pauseAt.current) {
            pauseAt.current = null;
            p.pauseVideo();
          }
        }, 200);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      clearInterval(timer);
      player.current?.destroy?.();
      player.current = null;
    };
  }, [id]);

  // "Pause after each line": stop right before the next line starts
  useEffect(() => {
    pauseAt.current = pauseEach && playing && active >= 0 && lines[active + 1] ? lines[active + 1].t + offset - 0.1 : null;
  }, [pauseEach, playing, active, lines, offset]);

  useEffect(() => {
    if (!follow || active < 0) return;
    lineEls.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, follow]);

  useEffect(() => {
    localStorage.setItem(`video:offset:${id}`, String(offset));
  }, [id, offset]);

  const seekLine = (i: number) => {
    const p = player.current;
    if (!p || !lines[i]) return;
    p.seekTo(Math.max(0, lines[i].t + offset - 0.2), true);
    p.playVideo();
    setFollow(true);
  };

  const toggleSlow = () => {
    player.current?.setPlaybackRate(slow ? 1 : 0.75);
    setSlow(!slow);
  };

  const translateLine = async (i: number) => {
    if (ru[i]) return;
    try {
      const text = await translateParagraph(lines[i].de);
      setRu((r) => ({ ...r, [i]: text }));
    } catch (e) {
      setRu((r) => ({ ...r, [i]: `⚠ ${(e as Error).message}` }));
    }
  };

  useEffect(() => {
    if (showRu && active >= 0) void translateLine(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRu, active]);

  const lookup = async (li: number, ti: number) => {
    player.current?.pauseVideo();
    const tok = parsed[li].tokens[ti];
    const sentence = lines[li].de;
    const my = ++reqId.current;
    setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence });
    try {
      const info = await translateWord(tok.text, sentence);
      const key = lemmaKey(info.lemma);
      const w = data.words[key];
      if (w && !w.deleted) linkForm(tok.form, key);
      if (my === reqId.current) setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence, info });
    } catch (e) {
      if (my === reqId.current) setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence, error: (e as Error).message });
    }
  };

  return (
    <>
      <div className="video-wrap">
        <div className="video-frame">
          <div ref={host} />
        </div>
        {lines.length > 0 && (
          <div className="video-now">
            {active >= 0 ? <Line parsed={parsed[active]} li={active} data={data} onWord={lookup} /> : <span className="muted">…</span>}
            {showRu && active >= 0 && <div className="video-ru">{ru[active] ?? 'Перевожу…'}</div>}
          </div>
        )}
        {lines.length > 0 && (
          <div className="video-ctrl">
            <button className="chip" onClick={() => seekLine(Math.max(active, 0))} disabled={!ready}>
              ↺ Фраза
            </button>
            <button className={`chip${slow ? ' on' : ''}`} onClick={toggleSlow} disabled={!ready}>
              🐢 0.75×
            </button>
            <button className={`chip${pauseEach ? ' on' : ''}`} onClick={() => setPauseEach(!pauseEach)}>
              ⏸ После фразы
            </button>
            <button className={`chip${showRu ? ' on' : ''}`} onClick={() => setShowRu(!showRu)}>
              RU
            </button>
            <span className="video-offset">
              <button className="chip" onClick={() => setOffset((o) => Math.round((o - 0.5) * 10) / 10)} aria-label="Субтитры раньше">
                −
              </button>
              <span className="small">{offset > 0 ? `+${offset}` : offset} с</span>
              <button className="chip" onClick={() => setOffset((o) => Math.round((o + 0.5) * 10) / 10)} aria-label="Субтитры позже">
                +
              </button>
            </span>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {children}

      {lines.length > 0 && (
        <div className="video-lines" onTouchMove={() => setFollow(false)} onWheel={() => setFollow(false)}>
          {!follow && (
            <button className="chip video-follow" onClick={() => setFollow(true)}>
              ⤓ К текущей фразе
            </button>
          )}
          {lines.map((l, i) => (
            <div key={i} ref={(el) => void (lineEls.current[i] = el)} className={`video-line${i === active ? ' on' : ''}`}>
              <button className="video-ts" onClick={() => seekLine(i)}>
                {fmt(Math.max(0, l.t + offset))}
              </button>
              <div>
                <Line parsed={parsed[i]} li={i} data={data} onWord={lookup} />
                {ru[i] && <div className="video-ru small">{ru[i]}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sheet && (
        <WordSheet
          state={sheet}
          source={source}
          onClose={() => setSheet(null)}
          onRetry={() => {
            const li = lines.findIndex((l) => l.de === sheet.sentence);
            const ti = li >= 0 && sheet.kind === 'word' ? parsed[li].tokens.findIndex((t) => t.text === sheet.word) : -1;
            if (ti >= 0) void lookup(li, ti);
          }}
        />
      )}
    </>
  );
}

function Line({ parsed, li, data, onWord }: { parsed: ReturnType<typeof parseText>[number] | undefined; li: number; data: ReturnType<typeof useData>; onWord: (li: number, ti: number) => void }) {
  if (!parsed) return null;
  return (
    <span className="video-de">
      {parsed.tokens.map((tok, ti) =>
        tok.word ? (
          <span key={ti} className={`w w-${statusOf(data, tok.form)}`} onClick={() => onWord(li, ti)}>
            {tok.text}
          </span>
        ) : (
          <span key={ti}>{tok.text}</span>
        ),
      )}
    </span>
  );
}
