import { currentStreak, DAILY_GOAL, liveTexts, streakDays, todayKey, todayProgress, useData, xpBoostActive } from '../lib/store';
import { levelOf } from '../lib/gamify';
import { lastOpenedText, levelAccent, PBar, Pill, readProgress, textLevel } from './ui';
import { TabBar, waitingCards, type Tab } from './TabBar';
import { SyncBadge } from './SyncBadge';

interface Props {
  onTab: (t: Tab) => void;
  onLearn: () => void;
  onOpenText: (id: string) => void;
  onChest: () => void;
  onAddKey: () => void;
}

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

/** Monday-first dates of the current week. */
function thisWeek(): string[] {
  const d = new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return WEEK.map((_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return todayKey(day);
  });
}

export function Home({ onTab, onLearn, onOpenText, onChest, onAddKey }: Props) {
  const data = useData();
  const streak = currentStreak(data);
  const done = streakDays(data);
  const lvl = levelOf(data.stats.xp);
  const p = todayProgress(data);
  const waiting = waitingCards(data);
  const goalMet = p.reviewed >= DAILY_GOAL;
  const chestClaimed = data.stats.chestDay === todayKey();
  const left = Math.max(0, DAILY_GOAL - p.reviewed);

  const lastId = lastOpenedText();
  const last = (lastId && data.texts[lastId] && !data.texts[lastId].deleted ? data.texts[lastId] : null) ?? liveTexts(data)[0] ?? null;

  return (
    <div className="screen">
      <div className="greet">
        <div>
          <div className="hello">{greeting()}</div>
          <div className="title">Los geht’s!</div>
        </div>
        <div className="pills">
          <SyncBadge />
          <Pill accent="sky">💎 {data.stats.gems}</Pill>
        </div>
      </div>

      {!data.settings.geminiKey && (
        <button className="key-banner" onClick={onAddKey}>
          <b>Добавь ключ Gemini</b>
          <span>Без него не работают перевод и создание текстов. Это бесплатно — займёт минуту.</span>
        </button>
      )}

      <div className="bento">
        <div className="tile streak c-peach">
          <div className="lbl">Серия</div>
          <div className="big-num">{streak}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>дней подряд 🔥</div>
          {data.stats.freezes > 0 && <div className="hint">🧊 заморозок: {data.stats.freezes}</div>}
          <div className="week">
            {thisWeek().map((day, i) => (
              <div key={day}>
                <i className={done.has(day) ? 'on' : ''} />
                <span>{WEEK[i][0]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tile c-lav">
          <div className="tile-head">
            <span style={{ opacity: 0.7 }}>Уровень</span>
            <span>{lvl.level}</span>
          </div>
          <div className="val">
            {data.stats.xp} <small>XP</small>
          </div>
          <div style={{ marginTop: 8 }}>
            <PBar value={lvl.into / lvl.need} h={8} onFill />
          </div>
          <div className="hint">{xpBoostActive(data) ? '⚡ 2× XP сейчас' : `${lvl.need - lvl.into} XP до ур. ${lvl.level + 1}`}</div>
        </div>

        <button className="tile c-butter" onClick={goalMet && !chestClaimed ? onChest : undefined}>
          <div className="lbl">Сундук дня</div>
          <div className="chest-tile-row">
            <div className={`gift ${goalMet && !chestClaimed ? 'chest-ready' : ''}`}>{chestClaimed ? '✓' : '🎁'}</div>
            <span>
              {chestClaimed ? (
                <>
                  Открыт!
                  <br />
                  Завтра новый
                </>
              ) : goalMet ? (
                <>
                  Готов —
                  <br />
                  открой!
                </>
              ) : (
                <>
                  ещё {left} карт.
                  <br />— и открыт
                </>
              )}
            </span>
          </div>
        </button>

        <div className="tile goal c-mint">
          <div className="goal-head">
            <b>Цель дня</b>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {Math.min(p.reviewed, DAILY_GOAL)} / {DAILY_GOAL}
              {goalMet ? ' ✓' : ' карточек'}
            </span>
          </div>
          <PBar value={p.reviewed / DAILY_GOAL} h={12} onFill />
          <button className="chunky c-card" onClick={onLearn}>
            {waiting > 0 ? `▶ Учить ${waiting} · ~${Math.max(1, Math.round(waiting / 5))} мин` : '▶ Повторить слова'}
          </button>
        </div>
      </div>

      {last && (
        <button className="continue" onClick={() => onOpenText(last.id)}>
          <div className={`lvl-block c-${levelAccent(textLevel(last))}`}>{textLevel(last)}</div>
          <div className="body">
            <div className="muted small" style={{ fontWeight: 600 }}>
              Продолжить чтение
            </div>
            <div className="ellipsis" style={{ fontWeight: 700, fontSize: 15 }}>
              {last.title}
            </div>
            <PBar value={readProgress(last.id)} accent="sky" h={6} />
          </div>
        </button>
      )}

      <TabBar active="home" onTab={onTab} onLearn={onLearn} />
    </div>
  );
}
