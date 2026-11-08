import { Boss } from './Boss';
import { currentStreak, DAILY_GOAL, liveChunks, liveTexts, streakDays, todayKey, todayProgress, unlockedWords, updateSettings, useData, xpBoostActive, type GameId, type LearnMode } from '../lib/store';
import { levelOf } from '../lib/gamify';
import { lastOpenedText, levelAccent, PBar, Pill, readProgress, textLevel } from './ui';
import { TabBar, waitingCards, type Tab } from './TabBar';
import { SyncBadge } from './SyncBadge';
import { Mascot, mascotMood, type DayMood } from './Mascot';
import { GAME_MIN_WORDS, GAMES, MIN_WORDS, recordLine } from './Games';
import { QuestsCard } from './Quests';
import { FocusBanner } from './Decks';
import { BADGES, wordTier } from '../lib/badges';

interface Props {
  onTab: (t: Tab) => void;
  onLearn: () => void;
  onOpenText: (id: string) => void;
  onChest: () => void;
  onAddKey: () => void;
  onGame: (id: GameId) => void;
  onQuestChest: () => void;
  onCollection: () => void;
  onLab: () => void;
  onVideo: () => void;
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

const PET_LINES: Record<DayMood, (streak: number, left: number) => [string, string]> = {
  happy: () => ['Super gemacht!', 'Цель дня выполнена — я доволен'],
  wait: (_, left) => ['Lernen wir?', `Ещё ${left} карточек до цели дня`],
  sad: (streak) => ['Ich vermisse dich…', streak > 0 ? 'Серия сгорит в полночь — давай позанимаемся' : 'Серия прервалась — начнём новую?'],
  sleep: (_, left) => ['Zzz… Gute Nacht', left ? 'Сплю… но карточки меня разбудят' : 'Сегодня всё сделано, сплю'],
};

/** The tamagotchi with a line that matches its mood; tap to learn. */
function PetCard({ streak, left, onLearn }: { streak: number; left: number; onLearn: () => void }) {
  const mood = mascotMood(useData());
  const [title, line] = PET_LINES[mood](streak, left);
  return (
    <button className="pet" onClick={onLearn}>
      <Mascot size={78} mood={mood} />
      <div>
        <b>{title}</b>
        <span>{line}</span>
      </div>
    </button>
  );
}

export function Home({ onTab, onLearn, onOpenText, onChest, onAddKey, onGame, onQuestChest, onCollection, onLab, onVideo }: Props) {
  const data = useData();
  const streak = currentStreak(data);
  const done = streakDays(data);
  const lvl = levelOf(data.stats.xp);
  const p = todayProgress(data);
  const waiting = waitingCards(data, 'all');
  const waitingChunks = waitingCards(data, 'chunks');
  const chunkCount = liveChunks(data).filter((c) => c.status === 'learning').length;
  const learnIn = (mode: LearnMode) => {
    updateSettings({ learnMode: mode });
    onLearn();
  };
  const goalMet = p.reviewed >= DAILY_GOAL;
  const chestClaimed = data.stats.chestDay === todayKey();
  const left = Math.max(0, DAILY_GOAL - p.reviewed);
  const gameWords = unlockedWords(data).length;
  const badgesEarned = Object.keys(data.stats.badges).length;
  const goldWords = Object.values(data.words).filter((w) => !w.deleted && wordTier(w) === 3).length;
  const bossWaiting = data.stats.bossWonDay !== todayKey() && gameWords >= GAME_MIN_WORDS;

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

      <PetCard streak={streak} left={left} onLearn={onLearn} />
      <FocusBanner />

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
          <button className="chunky c-card" onClick={() => learnIn('all')}>
            {waiting > 0 ? `▶ Учить ${waiting} · ~${Math.max(1, Math.round(waiting / 5))} мин` : '▶ Повторить'}
          </button>
        </div>

        <QuestsCard onChest={onQuestChest} />

        <button className="tile goal c-pink collection-tile" onClick={onCollection}>
          <div className="goal-head">
            <b>🏅 Коллекция</b>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Открыть ›</span>
          </div>
          <div className="collection-row">
            <span>
              <b>
                {badgesEarned}/{BADGES.length}
              </b>{' '}
              значков
            </span>
            <span>
              <b>{goldWords}</b> 🥇 слов
            </span>
          </div>
        </button>

        <div className="tile goal c-lav">
          <div className="goal-head">
            <b>🧩 Чанки</b>
            <button
              className="link"
              style={{ fontWeight: 700, fontSize: 14 }}
              onClick={() => {
                try {
                  sessionStorage.setItem('dictSegment', 'chunks');
                } catch {
                  // the dictionary just opens on words
                }
                onTab('words');
              }}
            >
              {chunkCount ? `${chunkCount} в колоде · ` : ''}+ Добавить
            </button>
          </div>
          {!chunkCount && <p className="small" style={{ margin: 0 }}>Пока пусто: нажми на слово в тексте → «🧩 Учить чанком» или добавь вручную.</p>}
          <button className="chunky c-card" onClick={() => learnIn('chunks')}>
            {waitingChunks > 0 ? `▶ Учить чанки · ${waitingChunks}` : '▶ Учить чанки'}
          </button>
        </div>

        <div className="tile goal c-sky">
          <div className="goal-head">
            <b>🎢 Аттракционы</b>
            {gameWords < GAME_MIN_WORDS && (
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                нужно {GAME_MIN_WORDS} слов · есть {gameWords}
              </span>
            )}
          </div>
          <div className="games-grid">
            {(Object.keys(GAMES) as GameId[]).map((id) => (
              <button key={id} className={`game-tile ${id === 'boss' && bossWaiting ? 'boss-ready' : ''} ${gameWords < MIN_WORDS[id] ? 'locked' : ''}`} onClick={() => onGame(id)}>
                <span className="ge">{gameWords < MIN_WORDS[id] ? '🔒' : id === 'boss' ? <Boss size={34} /> : GAMES[id].emoji}</span>
                <b>{GAMES[id].title}</b>
                <small>{gameWords < MIN_WORDS[id] ? `нужно ${MIN_WORDS[id]} слов · есть ${gameWords}` : recordLine(id)}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="lab-item c-pink-item" onClick={onVideo}>
        <span className="lab-ic">🎬</span>
        <div>
          <b>Видео с субтитрами</b>
          <span>Ролик с YouTube на немецком: субтитры бегут за видео, нажми на слово — перевод и «Учить».</span>
        </div>
      </button>

      <button className="lab-entry" onClick={onLab}>
        🧪 <b>Тестовое</b> <span>новые функции на обкатке ›</span>
      </button>

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
