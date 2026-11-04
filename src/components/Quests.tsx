import { useEffect, useState } from 'react';
import { getData, subscribeData, useData } from '../lib/store';
import { claimQuestChest, onReward, QUEST_XP, questChestRarity, questDef, rerollQuest, REROLL_GEMS, WEEKLY_XP, type RewardNote } from '../lib/quests';
import { checkBadges } from '../lib/badges';
import { RARITY, type Rarity } from '../lib/gamify';
import { sfx } from '../lib/sfx';
import { Confetti } from './SpecialCards';
import { PBar } from './ui';

const TOAST_MS = 2800;
const BADGE_CHECK_MS = 400;
let toastSeq = 0; // module-wide, so keys stay unique across remounts

/**
 * App-wide layer for rewards that can happen on any screen: a toast for a finished quest,
 * a celebration for a new badge. It also re-checks badges whenever the data changes.
 */
export function RewardLayer() {
  const [toasts, setToasts] = useState<{ n: number; note: RewardNote }[]>([]);
  const [badges, setBadges] = useState<RewardNote[]>([]);

  useEffect(() => {
    const off = onReward((note) => {
      if (note.kind === 'badge') {
        sfx.fanfare();
        setBadges((b) => [...b, note]);
        return;
      }
      sfx.chest();
      const n = ++toastSeq;
      setToasts((t) => [...t, { n, note }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.n !== n)), TOAST_MS);
    });
    let timer = 0;
    const offData = subscribeData(() => {
      clearTimeout(timer);
      timer = window.setTimeout(checkBadges, BADGE_CHECK_MS);
    });
    checkBadges();
    return () => {
      off();
      offData();
      clearTimeout(timer);
    };
  }, []);

  const badge = badges[0];
  return (
    <>
      <div className="reward-toasts">
        {toasts.map(({ n, note }) =>
          note.kind === 'badge' ? null : (
            <div key={n} className={`reward-toast ${note.kind}`}>
              <b>{note.kind === 'weekly' ? '🏆 Челлендж недели!' : note.allDone ? '🎉 Все задания дня!' : '✅ Задание выполнено'}</b>
              <span>
                {note.title} · +{note.xp} XP · +{note.gems} 💎
              </span>
            </div>
          ),
        )}
      </div>
      {badge?.kind === 'badge' && (
        <div className="overlay chest-screen badge-screen" onClick={() => setBadges((b) => b.slice(1))}>
          <div className="sunburst" />
          <Confetti count={150} />
          <div className="overlay-inner">
            <div className="overline">Новый значок</div>
            <div className="badge-big">{badge.emoji}</div>
            <div className="chest-title">{badge.title}</div>
            <div style={{ fontWeight: 600, opacity: 0.8, marginTop: 6 }}>{badge.desc}</div>
            <button className="chunky c-peach">Круто!</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Home card: today's three quests, the weekly challenge and the quest chest. */
export function QuestsCard({ onChest }: { onChest: () => void }) {
  const d = useData();
  const q = d.quests;
  if (!q.items.length) return null;
  const done = q.items.filter((it) => it.done).length;
  const weekly = q.weekly && questDef(q.weekly.id);

  return (
    <div className="tile goal c-butter quests">
      <div className="goal-head">
        <b>🎯 Задания дня</b>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{done} / 3</span>
      </div>
      {q.items.map((it) => {
        const def = questDef(it.id);
        if (!def) return null;
        return (
          <div key={it.id} className={`quest ${it.done ? 'done' : ''}`}>
            <div className="q-top">
              <span>
                {it.done ? '✓ ' : ''}
                {def.title}
              </span>
              <span className="q-rew">+{QUEST_XP[def.tier]} XP</span>
            </div>
            <PBar value={it.progress / def.target} h={8} onFill />
            <div className="q-meta">
              <span>
                {it.progress} / {def.target}
              </span>
              {!it.done && !q.rerolled && d.stats.gems >= REROLL_GEMS && (
                <button className="link q-swap" onClick={() => rerollQuest(it.id)}>
                  🔄 заменить · {REROLL_GEMS} 💎
                </button>
              )}
            </div>
          </div>
        );
      })}
      {q.chest === 'ready' && (
        <button className="chunky c-peach" onClick={onChest}>
          🎁 Открыть сундук заданий
        </button>
      )}
      {weekly && q.weekly && (
        <div className={`weekly ${q.weekly.done ? 'done' : ''}`}>
          <div className="q-top">
            <span>📅 Неделя: {weekly.title}</span>
            <span className="q-rew">+{WEEKLY_XP} XP</span>
          </div>
          <PBar value={q.weekly.progress / weekly.target} h={6} onFill />
        </div>
      )}
      {q.allDoneStreak > 0 && q.lastAllDoneDay >= dayBefore() && (
        <div className="q-streak">
          🔥 {q.allDoneStreak} дн. все задания подряд · каждый 7-й день — эпический сундук
        </div>
      )}
    </div>
  );
}

const dayBefore = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Chest for finishing all three quests: rarity shows first, the reward after it opens. */
export function QuestChestScreen({ onDone }: { onDone: () => void }) {
  const [rarity] = useState<Rarity>(questChestRarity);
  const [stage, setStage] = useState<'closed' | 'opening' | 'open'>('closed');
  const [got, setGot] = useState({ xp: 0, gems: 0 });
  const ready = getData().quests.chest === 'ready';

  const open = () => {
    if (stage !== 'closed' || !ready) return;
    setStage('opening');
    setTimeout(
      () => {
        setGot(claimQuestChest(rarity));
        sfx.chest();
        if (rarity === 'epic') sfx.fanfare();
        setStage('open');
      },
      rarity === 'epic' ? 1800 : 1200,
    );
  };

  return (
    <div className="overlay chest-screen">
      <div className="sunburst" />
      {stage === 'open' && <Confetti count={rarity === 'epic' ? 180 : 100} />}
      <div className="overlay-inner">
        <div className="overline">Сундук заданий</div>
        <span className={`pill rarity-pill r-${rarity}`}>{RARITY[rarity].label}</span>
        <button className={`chest-big r-${rarity} ${stage === 'opening' ? 'wiggle' : ''}`} onClick={open} aria-label="Открыть сундук">
          🎁
        </button>
        {stage === 'open' ? (
          <>
            <div className="chest-title">Внутри:</div>
            <div className="rewards">
              <div className="c-sky">
                <div className="ic">💎</div>
                <b>+{got.gems}</b>
                <span>кристаллов</span>
              </div>
              <div className="c-mint">
                <div className="ic">⭐</div>
                <b>+{got.xp}</b>
                <span>XP</span>
              </div>
            </div>
            <button className="chunky c-peach" onClick={onDone}>
              Забрать
            </button>
          </>
        ) : (
          <>
            <div className="chest-title">{!ready ? 'Уже открыт' : stage === 'opening' ? 'Открываю…' : 'Нажми на сундук'}</div>
            {!ready && (
              <button className="chunky c-peach" onClick={onDone}>
                Назад
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
