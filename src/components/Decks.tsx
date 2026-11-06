import { useMemo, useState } from 'react';
import {
  ARCHIVE,
  createDeck,
  deckActive,
  deckOf,
  deleteDeck,
  focusDeck,
  FULL_STRENGTH,
  liveDecks,
  LOOSE,
  moveWords,
  updateDeck,
  updateSettings,
  useData,
  type AppData,
  type DeckColor,
  type Word,
} from '../lib/store';
import { useBack } from '../lib/back';

/** Ready-made icons; any other emoji can be typed from the keyboard. */
const EMOJIS = ['💼', '🏠', '🍽️', '✈️', '🧚', '📰', '🎬', '🎵', '⚽', '🏥', '🛒', '🚆', '🏢', '🎓', '💬', '❤️', '🌳', '🐾', '☕', '🍺', '🧳', '🏦', '🔧', '💻', '📚', '🎮', '🎨', '🧠', '⭐', '🔥', '🌍', '🇩🇪', '🗣️', '📝', '🎯', '⏰', '👶', '🍀', '🐻', '🦊'];
const COLORS: DeckColor[] = ['mint', 'sky', 'pink', 'butter', 'peach', 'lav'];
const NAME_MAX = 24;

export interface DeckView {
  id: string; // deck id, LOOSE or ARCHIVE
  name: string;
  emoji: string;
  color: DeckColor | 'card';
}

/** How a section looks: user sections plus the two built-in ones. */
export function deckView(d: AppData, id: string): DeckView {
  if (id === ARCHIVE) return { id, name: 'Архив', emoji: '📦', color: 'card' };
  if (id === LOOSE) return { id, name: 'Без раздела', emoji: '🗂️', color: 'card' };
  const x = d.decks[id];
  return { id, name: x?.name ?? '—', emoji: x?.emoji ?? '📁', color: x?.color ?? 'mint' };
}

/** First visible character of what was typed (emoji with modifiers and flags count as one). */
function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) for (const g of new Seg(undefined, { granularity: 'grapheme' }).segment(t)) return g.segment;
  return Array.from(t)[0];
}

const endOfToday = () => new Date().setHours(23, 59, 59, 999);

function deckCounts(words: Word[]) {
  const eod = endOfToday();
  return {
    total: words.length,
    learning: words.filter((w) => w.status === 'learning').length,
    due: words.filter((w) => w.status === 'learning' && w.card && w.card.due <= eod).length,
    learned: words.filter((w) => w.status === 'known' || (w.card?.stability ?? 0) >= FULL_STRENGTH).length,
  };
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const wordsLabel = (n: number) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/* ---------- Row of sections above the word list ---------- */

export function DeckRow({ words, sel, onSel, onOpen, onNew }: { words: Word[]; sel: string; onSel: (id: string) => void; onOpen: (id: string) => void; onNew: () => void }) {
  const data = useData();
  const decks = liveDecks(data);
  const focus = focusDeck(data);
  const byDeck = useMemo(() => {
    const m = new Map<string, Word[]>();
    for (const w of words) {
      const k = deckOf(data, w);
      m.set(k, [...(m.get(k) ?? []), w]);
    }
    return m;
  }, [words, data]);

  // "Без раздела" only matters next to own sections, and only while it holds words
  const shown = [...(decks.length && (byDeck.has(LOOSE) || sel === LOOSE) ? [LOOSE] : []), ...decks.map((x) => x.id), ARCHIVE];

  const card = (id: string) => {
    const v = deckView(data, id);
    const c = deckCounts(byDeck.get(id) ?? []);
    const state = id === ARCHIVE ? null : focus ? (focus === id ? 'focus' : 'off') : deckActive(data, id) ? 'on' : 'off';
    return (
      <button key={id} className={`deck-card c-${v.color} ${sel === id ? 'on' : ''} ${state === 'off' ? 'paused' : ''}`} onClick={() => (sel === id ? onOpen(id) : onSel(id))}>
        {state && <span className={`deck-badge ${state}`}>{state === 'focus' ? '🎯' : state === 'on' ? '▶' : '⏸'}</span>}
        <span className="deck-emoji">{v.emoji}</span>
        <span className="deck-name">{v.name}</span>
        <span className="deck-count">
          {c.total}
          {c.due > 0 && id !== ARCHIVE ? ` · ${c.due} к повтору` : ''}
        </span>
        {sel === id && <span className="deck-more">настроить ›</span>}
      </button>
    );
  };

  return (
    <div className="deck-row" role="tablist" aria-label="Разделы">
      <button className={`deck-card c-butter ${sel === 'all' ? 'on' : ''}`} onClick={() => onSel('all')}>
        <span className="deck-emoji">📚</span>
        <span className="deck-name">Все</span>
        <span className="deck-count">{wordsLabel(words.length)}</span>
      </button>
      {shown.map(card)}
      <button className="deck-card deck-add" onClick={onNew}>
        <span className="deck-emoji">＋</span>
        <span className="deck-name">Раздел</span>
      </button>
    </div>
  );
}

/** "Studying only one section" strip with a way back to all of them. */
export function FocusBanner() {
  const data = useData();
  const focus = focusDeck(data);
  if (!focus) return null;
  const v = deckView(data, focus);
  return (
    <div className="focus-banner">
      <span>
        🎯 Учишь только «{v.emoji} {v.name}»
      </span>
      <button className="chip" onClick={() => updateSettings({ focusDeck: '' })}>
        Все разделы
      </button>
    </div>
  );
}

/* ---------- Section settings / new section ---------- */

export function DeckSheet({ id, onClose, onCreated, onLearn }: { id: string | 'new'; onClose: () => void; onCreated?: (id: string) => void; onLearn?: () => void }) {
  useBack(true, onClose);
  const data = useData();
  const isNew = id === 'new';
  const builtIn = id === LOOSE || id === ARCHIVE;
  const deck = !isNew && !builtIn ? data.decks[id] : undefined;
  const [name, setName] = useState(deck?.name ?? '');
  const [emoji, setEmoji] = useState(deck?.emoji ?? '');
  const [color, setColor] = useState<DeckColor>(deck?.color ?? COLORS[liveDecks(data).length % COLORS.length]);
  const [picking, setPicking] = useState(isNew);
  const [error, setError] = useState('');

  const words = useMemo(() => Object.values(data.words).filter((w) => !w.deleted && !isNew && deckOf(data, w) === id), [data, id, isNew]);
  const c = deckCounts(words);
  const v = isNew ? null : deckView(data, id);
  const s = data.settings;

  const pickEmoji = (e: string) => {
    setEmoji(e);
    setPicking(false);
    if (deck) updateDeck(deck.id, { emoji: e });
  };

  const create = () => {
    const n = name.trim();
    if (!n) return setError('Придумай название');
    const newId = createDeck(n, emoji || '📁', color);
    onCreated?.(newId);
    onClose();
  };

  const saveName = () => {
    const n = name.trim();
    if (deck && n && n !== deck.name) updateDeck(deck.id, { name: n });
    if (deck && !n) setName(deck.name);
  };

  const learnOnly = () => {
    updateSettings(s.learnMode === 'chunks' ? { focusDeck: id, learnMode: 'all' } : { focusDeck: id });
    onClose();
    onLearn?.();
  };

  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet deck-sheet" role="dialog" aria-label={isNew ? 'Новый раздел' : v!.name}>
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        {builtIn ? (
          <div className="deck-head">
            <span className="deck-big c-card">{v!.emoji}</span>
            <div>
              <h2>{v!.name}</h2>
              <p className="muted small">{id === ARCHIVE ? 'Выученные слова: лежат в словаре, но не повторяются' : 'Слова, которые ты не разложил по разделам'}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="deck-head">
              <button className={`deck-big c-${color}`} onClick={() => setPicking((p) => !p)} aria-label="Выбрать значок">
                {emoji || '＋'}
              </button>
              <input
                className="deck-name-input"
                value={name}
                maxLength={NAME_MAX}
                placeholder="Название раздела"
                autoFocus={isNew}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                onBlur={saveName}
                onKeyDown={(e) => e.key === 'Enter' && (isNew ? create() : (e.target as HTMLInputElement).blur())}
              />
            </div>
            {picking && (
              <div className="emoji-pick">
                <div className="emoji-grid">
                  {EMOJIS.map((e) => (
                    <button key={e} className={emoji === e ? 'on' : ''} onClick={() => pickEmoji(e)}>
                      {e}
                    </button>
                  ))}
                </div>
                <label className="emoji-own">
                  <span>Или свой — открой эмодзи на клавиатуре:</span>
                  <input
                    value=""
                    placeholder="😀"
                    onChange={(e) => {
                      const g = firstGrapheme(e.target.value);
                      if (g) pickEmoji(g);
                    }}
                  />
                </label>
              </div>
            )}
            <div className="color-dots" role="radiogroup" aria-label="Цвет">
              {COLORS.map((col) => (
                <button
                  key={col}
                  className={`c-${col} ${color === col ? 'on' : ''}`}
                  role="radio"
                  aria-checked={color === col}
                  aria-label={col}
                  onClick={() => {
                    setColor(col);
                    if (deck) updateDeck(deck.id, { color: col });
                  }}
                />
              ))}
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {isNew ? (
          <button className="chunky c-mint deck-cta" onClick={create}>
            Создать раздел
          </button>
        ) : (
          <>
            <div className="dict-stats three">
              <div className="c-lav">
                <b>{c.learning}</b>
                <span>учу</span>
              </div>
              <div className="c-peach">
                <b>{c.due}</b>
                <span>к повтору</span>
              </div>
              <div className="c-mint">
                <b>{c.learned}</b>
                <span>выучено</span>
              </div>
            </div>

            <div className="deck-settings">
              {id === ARCHIVE ? (
                <div className="set-row">
                  <span className="lbl">
                    Выученные — сюда сами
                    <small>Слова с прочностью 5/5 переезжают в архив после повторения</small>
                  </span>
                  <Switch on={s.autoArchive} onChange={(on) => updateSettings({ autoArchive: on })} label="Автоархив" />
                </div>
              ) : (
                <>
                  <div className="set-row">
                    <span className="lbl">
                      Учить в ленте
                      <small>{deckActive(data, id) ? 'Слова идут в «Учить» и игры' : 'На паузе: слова не повторяются, прогресс ждёт'}</small>
                    </span>
                    <Switch
                      on={deckActive(data, id)}
                      onChange={(on) => (id === LOOSE ? updateSettings({ looseActive: on }) : updateDeck(id, { active: on }))}
                      label="Учить в ленте"
                    />
                  </div>
                  {id !== LOOSE && <div className="set-row">
                    <span className="lbl">
                      Новые слова сюда
                      <small>Слова из читалки попадут в этот раздел</small>
                    </span>
                    <Switch
                      on={s.inboxDeck === id}
                      onChange={(on) => updateSettings({ inboxDeck: on ? id : '' })}
                      label="Новые слова сюда"
                    />
                  </div>}
                </>
              )}
            </div>

            {id !== ARCHIVE && c.learning > 0 && (
              <button className="chunky c-peach deck-cta" onClick={learnOnly}>
                ▶ Учить только этот раздел
              </button>
            )}
            {deck && (
              <button
                className="link danger deck-delete"
                onClick={() => {
                  if (!confirm(`Удалить раздел «${deck.name}»? Слова останутся в словаре без раздела.`)) return;
                  deleteDeck(deck.id);
                  onClose();
                }}
              >
                Удалить раздел (слова останутся)
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- Moving words between sections ---------- */

export function MoveSheet({ ids, onClose, onMoved }: { ids: string[]; onClose: () => void; onMoved?: () => void }) {
  useBack(true, onClose);
  const data = useData();
  const [creating, setCreating] = useState(false);
  const current = ids.length === 1 && data.words[ids[0]] ? deckOf(data, data.words[ids[0]]) : null;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of Object.values(data.words)) if (!w.deleted) m.set(deckOf(data, w), (m.get(deckOf(data, w)) ?? 0) + 1);
    return m;
  }, [data]);

  const move = (deck: string) => {
    moveWords(ids, deck);
    onMoved?.();
    onClose();
  };

  if (creating) return <DeckSheet id="new" onClose={() => setCreating(false)} onCreated={move} />;

  const opts = [...liveDecks(data).map((x) => x.id), LOOSE, ARCHIVE];
  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Переместить в раздел">
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 className="move-title">{ids.length === 1 ? 'Раздел слова' : `Переместить ${wordsLabel(ids.length)}`}</h2>
        <p className="muted small">Прогресс повторений сохранится</p>
        <div className="move-list">
          {opts.map((id) => {
            const v = deckView(data, id);
            const n = counts.get(id) ?? 0;
            return (
              <button key={id} className={`move-opt ${current === id ? 'on' : ''}`} onClick={() => move(id)}>
                <span className={`deck-big small c-${v.color}`}>{v.emoji}</span>
                <span className="move-text">
                  <b>{v.name}</b>
                  <small>{id === ARCHIVE ? 'Не учить, но оставить в словаре' : `${wordsLabel(n)} · ${deckActive(data, id) ? 'учу' : 'на паузе'}`}</small>
                </span>
                {current === id && <span className="move-check">✓</span>}
              </button>
            );
          })}
          <button className="move-opt dashed" onClick={() => setCreating(true)}>
            <span className="deck-big small c-card">＋</span>
            <span className="move-text">
              <b>Новый раздел…</b>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
