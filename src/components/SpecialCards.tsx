import { useEffect, useRef, useState } from 'react';
import { getData, markMilestone, useData, type Word } from '../lib/store';
import { fullGerman, shortTranslation } from '../lib/feed';
import { levelOf, RARITY, rollRange, rollRarity, rollUpgrade, XP, type Rarity } from '../lib/gamify';
import { checkSentence, type SentenceCheck } from '../lib/gemini';
import { sfx } from '../lib/sfx';

const BLITZ_SECONDS = 10;

function NextButton({ onNext }: { onNext: () => void }) {
  return (
    <button className="primary feed-cta" onClick={onNext}>
      Дальше ↑
    </button>
  );
}

/** Short confetti burst drawn inside the card (never over other UI); `count`/`power` scale it down for small wins. */
export function Confetti({ count = 90, power = 1 }: { count?: number; power?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const w = (c.width = c.offsetWidth * devicePixelRatio);
    const h = (c.height = c.offsetHeight * devicePixelRatio);
    const colors = ['#ffcdb5', '#d7ccfe', '#b6f1d6', '#fcebae', '#b5e2fd', '#fecbd9'];
    const parts = Array.from({ length: count }, () => ({
      x: w / 2,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 14 * power * devicePixelRatio,
      vy: (-Math.random() * 12 - 4) * power * devicePixelRatio,
      s: (4 + Math.random() * 5) * devicePixelRatio,
      r: Math.random() * Math.PI,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    const start = performance.now();
    const frame = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.45 * devicePixelRatio;
        p.x += p.vx;
        p.y += p.vy;
        p.r += 0.15;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (t - start < 1800) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}

/** In-feed chest: its rarity shows before opening, and it may upgrade while it shakes. */
export function ChestCard({ done, onOpen, onNext }: { done: boolean; onOpen: (xp: number) => void; onNext: () => void }) {
  const [rarity, setRarity] = useState<Rarity>(rollRarity);
  const [opening, setOpening] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const [reward, setReward] = useState(0);

  const open = () => {
    if (opening || done) return;
    setOpening(true);
    const final = rollUpgrade(rarity);
    const shake = rarity === 'epic' ? 1200 : 700;
    if (final !== rarity) {
      // The upgrade lands mid-shake, then the chest keeps shaking a bit longer
      setTimeout(() => {
        setRarity(final);
        setUpgraded(true);
        sfx.upgrade();
      }, shake);
    }
    setTimeout(() => {
      const xp = rollRange(RARITY[final].xp);
      setReward(xp);
      sfx.chest();
      if (final === 'epic') sfx.fanfare();
      onOpen(xp);
    }, final !== rarity ? shake + 900 : shake);
  };

  return (
    <>
      <span className={`pill rarity-pill r-${rarity} ${upgraded ? 'bump' : ''}`}>{upgraded ? `Апгрейд! ${RARITY[rarity].label}` : RARITY[rarity].label}</span>
      {done ? (
        <>
          <Confetti count={rarity === 'epic' ? 160 : rarity === 'rare' ? 110 : 70} />
          <div className="chest-reward">+{reward} XP</div>
          <p className="muted">{rarity === 'epic' ? 'Джекпот!' : rarity === 'rare' ? 'Отличный улов' : 'Неплохо'}</p>
          <NextButton onNext={onNext} />
        </>
      ) : (
        <>
          <button className={`chest r-${rarity} ${opening ? 'opening' : ''}`} onClick={open} aria-label="Открыть сундук">
            🎁
          </button>
          <p className="muted">
            Нажми, чтобы открыть: {RARITY[rarity].xp[0]}–{RARITY[rarity].xp[1]} XP{rarity !== 'epic' ? ' · может стать круче' : ''}
          </p>
        </>
      )}
    </>
  );
}

export function BlitzCard({ ids, done, onFinish, onNext }: { ids: string[]; done: boolean; onFinish: (xp: number) => void; onNext: () => void }) {
  const data = useData();
  const nouns = ids.map((id) => data.words[id]).filter((w): w is Word => !!w && !w.deleted && !!w.article);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(BLITZ_SECONDS * 1000);
  const [idx, setIdx] = useState(0);
  const [hits, setHits] = useState(0);
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const hitsRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const end = Date.now() + BLITZ_SECONDS * 1000;
    const t = setInterval(() => {
      const ms = Math.max(0, end - Date.now());
      setLeft(ms);
      if (ms === 0) {
        clearInterval(t);
        setRunning(false);
        sfx.fanfare();
        onFinish(hitsRef.current * XP.blitzHit);
      }
    }, 100);
    return () => clearInterval(t);
  }, [running]);

  const w = nouns[idx % Math.max(1, nouns.length)];

  const pick = (a: string) => {
    if (!running || !w) return;
    const ok = a === w.article;
    if (ok) {
      hitsRef.current++;
      setHits(hitsRef.current);
      sfx.correct(hitsRef.current);
    } else sfx.wrong();
    setFlash(ok ? 'ok' : 'bad');
    setTimeout(() => setFlash(null), 150);
    setIdx((i) => i + 1);
  };

  if (done) {
    return (
      <>
        <span className="feed-label">Блиц завершён</span>
        <Confetti />
        <div className="chest-reward">{hits} верных</div>
        <p className="muted">+{hits * XP.blitzHit} XP</p>
        <NextButton onNext={onNext} />
      </>
    );
  }

  if (!running) {
    return (
      <>
        <span className="feed-label">Блиц</span>
        <p className="feed-tr">10 секунд: der, die или das?</p>
        <p className="muted">Сколько успеешь — за каждый верный +{XP.blitzHit} XP</p>
        <button
          className="primary feed-cta"
          onClick={() => {
            sfx.tick();
            setRunning(true);
          }}
        >
          Старт
        </button>
      </>
    );
  }

  return (
    <>
      <div className="blitz-timer">
        <i style={{ width: `${(left / (BLITZ_SECONDS * 1000)) * 100}%` }} />
      </div>
      <span className="feed-label">Верных: {hits}</span>
      <div key={idx} className={`feed-word blitz-word ${flash ?? ''}`}>
        {w?.lemma}
      </div>
      <div className="options row3">
        {['der', 'die', 'das'].map((a) => (
          <button key={a} className={`option art-${a}`} onClick={() => pick(a)}>
            {a}
          </button>
        ))}
      </div>
    </>
  );
}

export function MilestoneCard({ n, onShown, onNext }: { n: number; onShown: () => void; onNext: () => void }) {
  useEffect(() => {
    markMilestone(n);
    sfx.fanfare();
    onShown();
  }, []);
  return (
    <>
      <Confetti />
      <span className="feed-label">Новый рубеж</span>
      <div className="chest-reward">{n} слов</div>
      <p className="muted">Уже столько слов в твоём словаре. Так держать!</p>
      <NextButton onNext={onNext} />
    </>
  );
}

export function GoalCard({ streak, onShown, onNext }: { streak: number; onShown: () => void; onNext: () => void }) {
  const { level, into, need } = levelOf(getData().stats.xp);
  useEffect(() => {
    sfx.fanfare();
    onShown();
  }, []);
  return (
    <>
      <Confetti />
      <span className="feed-label">Цель дня выполнена</span>
      <div className="chest-reward">🔥 {streak}</div>
      <p className="feed-tr">{streak === 1 ? 'Серия началась!' : `${streak} дней подряд`}</p>
      <p className="muted">
        Уровень {level} · {into}/{need} XP
      </p>
      <p className="small muted">Можно продолжать — лента бесконечная.</p>
      <NextButton onNext={onNext} />
    </>
  );
}

export function SentenceCard({ w, done, onFinish, onNext }: { w: Word; done: boolean; onFinish: (xp: number) => void; onNext: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<SentenceCheck | null>(null);

  const submit = async () => {
    if (!text.trim()) {
      setError('Сначала напиши предложение');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await checkSentence(fullGerman(w), text.trim());
      setCheck(r);
      const xp = !r.usesWord ? 0 : r.ok ? XP.sentenceOk : XP.sentenceFixed;
      if (r.ok && r.usesWord) sfx.correct(3);
      else sfx.almost();
      onFinish(xp);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="feed-label">Составь предложение со словом</span>
      <div className="feed-word">{fullGerman(w)}</div>
      <p className="muted">{shortTranslation(w)}</p>
      <textarea
        className="sentence-input"
        rows={3}
        value={text}
        disabled={busy || done}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        placeholder="Ich …"
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
      />
      {!done && (
        <div className="row">
          <button className="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Проверяю…' : 'Проверить'}
          </button>
          <button className="link" onClick={() => onFinish(0)}>
            Пропустить
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {check && (
        <div className="sentence-result">
          {!check.usesWord ? (
            <p className="verdict again">Слово «{w.lemma}» не использовано</p>
          ) : check.ok ? (
            <p className="verdict good">Без ошибок! +{XP.sentenceOk} XP</p>
          ) : (
            <p className="verdict hard">Есть ошибки · +{XP.sentenceFixed} XP за попытку</p>
          )}
          {check.issues.map((i, k) => (
            <p key={k} className="issue">
              <s>{i.wrong}</s> → <b>{i.right}</b>
              <span className="small muted"> — {i.explanation}</span>
            </p>
          ))}
          {!check.ok && <p className="small">Правильно: «{check.corrected}»</p>}
          {check.comment && <p className="small muted">{check.comment}</p>}
        </div>
      )}
      {done && <NextButton onNext={onNext} />}
    </>
  );
}
