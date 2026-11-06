import { useEffect, useMemo, useRef, useState } from 'react';
import { GeminiError, transcribeVideo, translateParagraph, translateWord, type VideoLine } from '../lib/gemini';
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
  chunks?: number[]; // Gemini subtitles are made per CHUNK seconds; these are done (absent = complete)
}

// Gemini subtitles are made in chunks just ahead of playback, so watching starts in ~20 s and a long
// video never spends quota on parts nobody watched.
const CHUNK = 180;
const OVERLAP = 4; // each clip asks a bit more on both sides so lines on a boundary aren't cut
const AHEAD = 2; // chunks prepared ahead of the one playing
const PARALLEL = 3;
const chunkOf = (t: number) => Math.max(0, Math.floor(t / CHUNK));

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

const lineKey = (l: VideoLine) => `${l.t}|${l.de}`;
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// --- Minimal YouTube IFrame API typing ---

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
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
  const [error, setError] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  // Playback position reported by the player, as a chunk index, and the video length
  const [cur, setCur] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState<number[]>([]);
  const inflight = useRef(new Set<number>());
  const waitUntil = useRef(0); // after a rate-limit error, pause new requests until then
  const [retryTick, setRetryTick] = useState(0);
  const trRef = useRef<Transcript | null>(null);
  const idRef = useRef<string | null>(null);
  trRef.current = tr;
  idRef.current = id;

  const open = (raw: string) => {
    const vid = videoIdOf(raw);
    setError('');
    if (!vid) {
      setError('Не похоже на ссылку YouTube');
      return;
    }
    localStorage.setItem('video:last', raw.trim());
    inflight.current.clear();
    waitUntil.current = 0;
    setLoading([]);
    setCur(0);
    setDuration(0);
    setId(vid);
    setTr(loadCached(vid));
    setPaste(null);
  };

  const save = (vid: string, t: Transcript) => {
    localStorage.setItem(cacheKey(vid), JSON.stringify(t));
    if (idRef.current !== vid) return;
    trRef.current = t;
    setTr(t);
  };

  const total = duration ? Math.ceil(duration / CHUNK) : 0;
  const pending = tr?.chunks ? Array.from({ length: total }, (_, k) => k).filter((k) => !tr.chunks!.includes(k)) : [];

  /** Makes subtitles for one chunk and merges them in, keeping only lines that start inside it. */
  const loadChunk = async (vid: string, k: number) => {
    inflight.current.add(k);
    setLoading([...inflight.current]);
    const start = k * CHUNK;
    const end = Math.min(start + CHUNK, duration);
    try {
      const r = await transcribeVideo(`https://www.youtube.com/watch?v=${vid}`, {
        start: Math.max(0, start - OVERLAP),
        end: Math.min(duration, end + OVERLAP),
      });
      const own = r.lines.filter((l) => (k === 0 || l.t >= start) && (l.t < end || end >= duration));
      // Merge into the latest saved copy (other chunks may have finished meanwhile)
      const prev = idRef.current === vid ? trRef.current : loadCached(vid);
      if (!prev?.chunks) return;
      const lines = [...prev.lines.filter((l) => l.t < start || l.t >= end), ...own].sort((a, b) => a.t - b.t);
      save(vid, {
        ...prev,
        title: prev.title === 'Видео' && r.title ? r.title : prev.title,
        lines,
        chunks: [...new Set([...prev.chunks, k])].sort((a, b) => a - b),
      });
      // Keep a rate-limit notice visible while its pause lasts
      if (idRef.current === vid && Date.now() >= waitUntil.current) setError('');
    } catch (e) {
      if (idRef.current !== vid) return;
      const status = e instanceof GeminiError ? e.status : 0;
      if (status === 429 || status === 408 || status === 503) {
        // Rate limit or a hang: wait a bit, then the scheduler tries again
        waitUntil.current = Date.now() + 20000;
        setTimeout(() => setRetryTick((n) => n + 1), 20500);
        setError(status === 429 ? 'Лимит Gemini в минуту — продолжу через 20 секунд' : 'Gemini долго молчит — попробую ещё раз');
      } else {
        setError(e instanceof Error ? e.message : 'Не получилось');
        waitUntil.current = Number.MAX_SAFE_INTEGER; // stop until the user taps «Повторить»
      }
    } finally {
      if (idRef.current === vid) {
        inflight.current.delete(k);
        setLoading([...inflight.current]);
      }
    }
  };

  // Scheduler: the chunk playing now first, then the next AHEAD ones, at most PARALLEL at a time
  useEffect(() => {
    if (!id || !tr?.chunks || !total || Date.now() < waitUntil.current) return;
    const wanted: number[] = [];
    for (let k = cur; k <= Math.min(total - 1, cur + AHEAD); k++) if (!tr.chunks.includes(k) && !inflight.current.has(k)) wanted.push(k);
    for (const k of wanted.slice(0, Math.max(0, PARALLEL - inflight.current.size))) void loadChunk(id, k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tr, cur, total, loading.length, retryTick]);

  const startGemini = () => {
    if (!id) return;
    setError('');
    waitUntil.current = 0;
    save(id, { title: 'Видео', lines: [], source: 'gemini', chunks: [] });
  };

  const retry = () => {
    setError('');
    waitUntil.current = 0;
    setRetryTick((n) => n + 1);
  };

  const applyPaste = () => {
    const lines = parsePasted(paste ?? '');
    if (lines.length < 2) {
      setError('Не нашёл таймкодов. Нужен текст из «Показать расшифровку» на YouTube: время, потом фраза.');
      return;
    }
    if (id) save(id, { title: 'Видео', lines, source: 'paste' });
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
      <Player
        key={id}
        id={id}
        lines={tr?.lines ?? []}
        source={tr?.title}
        waiting={!!tr?.chunks && total > 0 && !tr.chunks.includes(cur)}
        onTick={(t, d) => {
          setCur((c) => (chunkOf(t) === c ? c : chunkOf(t)));
          setDuration((old) => (d && Math.abs(d - old) > 1 ? d : old));
        }}
      >
        {!tr && paste === null && (
          <div className="video-empty">
            <button className="chunky c-peach wide" onClick={startGemini} disabled={!hasKey}>
              ✨ Сделать субтитры (Gemini)
            </button>
            {!hasKey && <p className="muted small">Нужен ключ Gemini в настройках.</p>}
            <button className="chunky c-card wide" onClick={() => setPaste('')}>
              📋 Вставить расшифровку с YouTube
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {tr?.chunks && total > 0 && (pending.length > 0 || error) && (
          <div className="video-status small">
            {pending.length === 0 ? 'Субтитры готовы' : `Субтитры: готово ${total - pending.length} из ${total}${loading.length ? ' · готовлю…' : ''}`}
            {error && (
              <>
                <span className="error"> {error}</span>{' '}
                <button className="link" onClick={retry}>
                  Повторить
                </button>
              </>
            )}
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

interface PlayerProps {
  id: string;
  lines: VideoLine[];
  source?: string;
  waiting: boolean; // subtitles for the part playing now are still being made
  onTick: (time: number, duration: number) => void;
  children: React.ReactNode;
}

function Player({ id, lines, source, waiting, onTick, children }: PlayerProps) {
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
  const [ru, setRu] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [follow, setFollow] = useState(true);
  const reqId = useRef(0);
  const lineEls = useRef<(HTMLDivElement | null)[]>([]);
  const pauseAt = useRef<number | null>(null);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

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
          tickRef.current(t, p.getDuration?.() ?? 0);
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
    const k = lineKey(lines[i]);
    if (ru[k]) return;
    try {
      const text = await translateParagraph(lines[i].de);
      setRu((r) => ({ ...r, [k]: text }));
    } catch (e) {
      setRu((r) => ({ ...r, [k]: `⚠ ${(e as Error).message}` }));
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
        {(lines.length > 0 || waiting) && (
          <div className="video-now">
            {waiting ? (
              <span className="muted video-wait">Готовлю субтитры к этому месту…</span>
            ) : active >= 0 ? (
              <Line parsed={parsed[active]} li={active} data={data} onWord={lookup} />
            ) : (
              <span className="muted">…</span>
            )}
            {showRu && active >= 0 && <div className="video-ru">{ru[lineKey(lines[active])] ?? 'Перевожу…'}</div>}
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
                {ru[lineKey(l)] && <div className="video-ru small">{ru[lineKey(l)]}</div>}
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
