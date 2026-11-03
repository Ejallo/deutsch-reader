import { useState } from 'react';
import { claimChest, currentStreak, DAILY_GOAL, getData, todayKey, todayProgress } from '../lib/store';
import { levelOf, RARITY, rollChest } from '../lib/gamify';
import { sfx } from '../lib/sfx';
import { Confetti } from './SpecialCards';
import { Mascot, PBar } from './ui';

export interface SessionStats {
  xp: number;
  correct: number;
  wrong: number;
  maxCombo: number;
}

/** «Super gemacht!» — shown when the daily goal is reached. */
export function LessonSummary({ stats, onChest, onContinue }: { stats: SessionStats; onChest: () => void; onContinue: () => void }) {
  const d = getData();
  const streak = currentStreak(d);
  const lvl = levelOf(d.stats.xp);
  const answered = stats.correct + stats.wrong;
  const accuracy = answered ? Math.round((stats.correct / answered) * 100) : 100;
  const chestClaimed = d.stats.chestDay === todayKey();

  return (
    <div className="overlay">
      <Confetti />
      <div className="overlay-inner">
        <Mascot mood="happy" />
        <div className="summary-title">Super gemacht!</div>
        <div className="muted" style={{ fontWeight: 600, marginTop: 6 }}>
          Цель дня выполнена · {todayProgress(d).reviewed} карточек{stats.wrong ? ` · ошибок: ${stats.wrong}` : ''}
        </div>
        <div className="stat-tiles">
          <div className="c-lav">
            <b>+{stats.xp}</b>
            <span>XP</span>
          </div>
          <div className="c-mint">
            <b>{accuracy}%</b>
            <span>точность</span>
          </div>
          <div className="c-butter">
            <b>×{stats.maxCombo}</b>
            <span>комбо</span>
          </div>
        </div>
        <div className="streak-card">
          <b>{streak}</b>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{streak === 1 ? 'день серии 🔥' : 'дней подряд 🔥'}</div>
            <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.75 }}>Завтра — ещё {DAILY_GOAL} карточек, и серия растёт</div>
          </div>
        </div>
        <div className="level-card">
          <div className="top">
            <span>
              Уровень {lvl.level} → {lvl.level + 1}
            </span>
            <span className="muted">
              {lvl.into} / {lvl.need}
            </span>
          </div>
          <PBar value={lvl.into / lvl.need} accent="lav" />
        </div>
        {chestClaimed ? (
          <button className="chunky c-peach" onClick={onContinue}>
            Продолжить
          </button>
        ) : (
          <>
            <button className="chunky c-butter" onClick={onChest}>
              🎁 Забрать сундук
            </button>
            <button className="link" onClick={onContinue}>
              Позже, учить дальше
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Daily chest: tap to open, see the rewards, claim them. */
export function ChestScreen({ onDone }: { onDone: () => void }) {
  const [rewards] = useState(rollChest);
  const [stage, setStage] = useState<'closed' | 'opening' | 'open'>('closed');
  const claimed = getData().stats.chestDay === todayKey();

  const open = () => {
    if (stage !== 'closed') return;
    setStage('opening');
    setTimeout(() => {
      sfx.chest();
      if (rewards.rarity === 'epic') sfx.fanfare();
      setStage('open');
    }, rewards.rarity === 'epic' ? 1800 : 1200);
  };

  const take = () => {
    if (!claimed) claimChest(rewards);
    sfx.fanfare();
    onDone();
  };

  return (
    <div className="overlay chest-screen">
      <div className="sunburst" />
      {stage === 'open' && <Confetti count={rewards.rarity === 'epic' ? 180 : 90} />}
      <div className="overlay-inner">
        <div className="overline">{stage === 'open' ? 'Сундук дня' : 'Нажми на сундук'}</div>
        <span className={`pill rarity-pill r-${rewards.rarity}`}>{RARITY[rewards.rarity].label}</span>
        <button className={`chest-big r-${rewards.rarity} ${stage === 'opening' ? 'wiggle' : ''}`} onClick={open} aria-label="Открыть сундук">
          🎁
        </button>
        {stage === 'open' ? (
          <>
            <div className="chest-title">Внутри:</div>
            <div className="rewards">
              <div className="c-sky">
                <div className="ic">💎</div>
                <b>+{rewards.gems}</b>
                <span>кристаллов</span>
              </div>
              {rewards.freeze ? (
                <div className="c-mint">
                  <div className="ic">🧊</div>
                  <b>×1</b>
                  <span>заморозка серии</span>
                </div>
              ) : (
                <div className="c-mint">
                  <div className="ic">⭐</div>
                  <b>+{rewards.bonusXp}</b>
                  <span>XP</span>
                </div>
              )}
              <div className="c-peach">
                <div className="ic">⚡</div>
                <b>2×</b>
                <span>XP на {rewards.boostMinutes} мин</span>
              </div>
            </div>
            <button className="chunky c-peach" onClick={take}>
              Забрать всё
            </button>
          </>
        ) : (
          <div className="chest-title">{stage === 'opening' ? 'Открываю…' : 'Что внутри?'}</div>
        )}
      </div>
    </div>
  );
}

/** Full-screen celebration when an answer crosses into a new level. */
export function LevelUpScreen({ level, onDone }: { level: number; onDone: () => void }) {
  return (
    <div className="overlay chest-screen levelup-screen" onClick={onDone}>
      <div className="sunburst" />
      <Confetti count={150} />
      <div className="overlay-inner">
        <div className="overline">Новый уровень</div>
        <div className="levelup-badge">{level}</div>
        <Mascot mood="happy" />
        <div className="chest-title">Уровень {level}!</div>
        <div style={{ fontWeight: 600, opacity: 0.8, marginTop: 6 }}>Каждое слово приближает следующий</div>
        <button className="chunky c-peach" onClick={onDone}>
          Круто!
        </button>
      </div>
    </div>
  );
}
