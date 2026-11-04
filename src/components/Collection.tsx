import { useState } from 'react';
import { useData } from '../lib/store';
import { BADGES, TIER_ICON, TIER_NAME, wordTier, type Tier } from '../lib/badges';
import { fullGerman, shortTranslation } from '../lib/feed';
import { speak } from '../lib/tts';
import { TopBar } from './ui';

/** Badges earned and still locked, plus the word album ranked by how well each word is remembered. */
export function Collection({ onBack }: { onBack: () => void }) {
  const d = useData();
  const [tab, setTab] = useState<'badges' | 'album'>('badges');
  const [tier, setTier] = useState<Tier | null>(null);
  const earned = BADGES.filter((b) => d.stats.badges[b.id]).length;

  const words = Object.values(d.words)
    .filter((w) => !w.deleted)
    .map((w) => ({ w, t: wordTier(w) }))
    .sort((a, b) => b.t - a.t || a.w.lemma.localeCompare(b.w.lemma, 'de'));
  const counts = [0, 1, 2, 3].map((t) => words.filter((x) => x.t === t).length);
  const shown = tier === null ? words : words.filter((x) => x.t === tier);

  return (
    <div className="screen">
      <TopBar title="Коллекция" back="Главная" onBack={onBack} />
      <div className="segment">
        <button className={tab === 'badges' ? 'on' : ''} onClick={() => setTab('badges')}>
          🏅 Значки · {earned}/{BADGES.length}
        </button>
        <button className={tab === 'album' ? 'on' : ''} onClick={() => setTab('album')}>
          📒 Альбом · {words.length}
        </button>
      </div>

      {tab === 'badges' ? (
        <div className="badge-grid">
          {BADGES.map((b) => {
            const at = d.stats.badges[b.id];
            const [cur, target] = b.progress(d);
            return (
              <div key={b.id} className={`badge ${at ? 'on' : ''}`}>
                <div className="badge-ic">{b.emoji}</div>
                <b>{b.title}</b>
                <small>{b.desc}</small>
                <span className="badge-state">{at ? `✓ ${new Date(at).toLocaleDateString('ru-RU')}` : `${Math.min(cur, target)} / ${target}`}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <p className="muted small" style={{ fontWeight: 600 }}>
            Слово растёт в ранге, пока ты его помнишь: бронза — от 3 дней, серебро — от 3 недель, золото — от 3 месяцев или «знаю».
          </p>
          <div className="tier-chips">
            <button className={tier === null ? 'on' : ''} onClick={() => setTier(null)}>
              Все · {words.length}
            </button>
            {([3, 2, 1, 0] as Tier[]).map((t) => (
              <button key={t} className={`t${t} ${tier === t ? 'on' : ''}`} onClick={() => setTier(tier === t ? null : t)}>
                {TIER_ICON[t] || '○'} {TIER_NAME[t]} · {counts[t]}
              </button>
            ))}
          </div>
          {shown.length ? (
            <div className="album">
              {shown.map(({ w, t }) => (
                <button key={w.id} className={`album-card t${t}`} onClick={() => speak(fullGerman(w))}>
                  {t > 0 && <span className="album-tier">{TIER_ICON[t]}</span>}
                  <b>{fullGerman(w)}</b>
                  <small>{shortTranslation(w)}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Здесь пока пусто.</p>
          )}
        </>
      )}
    </div>
  );
}
