import { useEffect, useRef, useState } from 'react';
import { addXp, DIALOG_DECK, ensureDialogDeck, getData, lemmaKey, removeWords, saveWord, type Word } from '../lib/store';
import { reviewDialog, type ChatLine, type DialogReview } from '../lib/gemini';
import { questEvent } from '../lib/quests';
import { sfx } from '../lib/sfx';
import { TopBar } from './ui';

// End of a voice dialog: one review of the whole transcript, and everything it finds goes to the dialog section.

const XP_PER_LINE = 5;
const XP_CAP = 100;

interface Item {
  key: string;
  de: string;
  ru: string;
  /** What the learner said wrong, for a corrected phrase. */
  said?: string;
  note?: string;
  isNew: boolean;
}

type Entry = Omit<Word, 'id' | 'createdAt' | 'updatedAt'>;

/** Saves the review into the dialog section. Words already in the dictionary stay untouched in their own section. */
function saveReview(r: DialogReview): { words: Item[]; fixes: Item[] } {
  ensureDialogDeck();
  const seen = new Set<string>();
  const keep = (entry: Entry, item: Omit<Item, 'key' | 'isNew'>): Item[] => {
    const key = lemmaKey(entry.lemma);
    if (!key || !entry.translation.trim() || seen.has(key)) return [];
    seen.add(key);
    const before = getData().words[key];
    const isNew = !before || !!before.deleted;
    if (isNew) saveWord(key, entry);
    return [{ ...item, key, isNew }];
  };
  const base = { status: 'learning' as const, deck: DIALOG_DECK };
  return {
    words: r.words.flatMap((w) =>
      keep(
        { ...base, lemma: w.lemma, article: w.article, plural: w.plural, pos: w.pos, translation: w.translation, meanings: w.meanings, note: '', example: w.example },
        { de: w.article ? `${w.article} ${w.lemma}` : w.lemma, ru: w.translation },
      ),
    ),
    fixes: r.fixes.flatMap((f) =>
      keep(
        { ...base, lemma: f.phrase, article: '', plural: '', pos: 'фраза', translation: f.translation, meanings: '', note: `Было: «${f.said}». ${f.explanation}`, example: f.phrase },
        { de: f.phrase, ru: f.translation, said: f.said, note: f.explanation },
      ),
    ),
  };
}

function Row({ item, onRemove }: { item: Item; onRemove: () => void }) {
  return (
    <div className="dialog-row">
      <div>
        {item.said && <s>{item.said}</s>}
        <b>{item.de}</b>
        <span>{item.ru}</span>
        {item.note && <small>{item.note}</small>}
      </div>
      {item.isNew ? (
        <button onClick={onRemove} aria-label={`Убрать ${item.de} из словаря`}>
          ✕
        </button>
      ) : (
        <em>уже в словаре</em>
      )}
    </div>
  );
}

export function DialogSummary({ lines, level, seconds, onBack }: { lines: ChatLine[]; level: string; seconds: number; onBack: () => void }) {
  const mine = lines.filter((l) => l.role === 'me');
  const [result, setResult] = useState<{ words: Item[]; fixes: Item[] } | null>(null);
  const [error, setError] = useState('');
  const [xp, setXp] = useState(0);
  const started = useRef(false);

  const run = () => {
    setError('');
    reviewDialog(level, lines)
      .then((r) => setResult(saveReview(r)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не получилось разобрать разговор'));
  };

  // Once on arrival (the ref also survives StrictMode's double effect run)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const got = addXp(Math.min(XP_CAP, mine.length * XP_PER_LINE));
    questEvent('xp', got);
    sfx.fanfare();
    setXp(got);
    if (mine.length) run();
    else setResult({ words: [], fixes: [] });
  }, []);

  const remove = (key: string) => {
    removeWords([key]);
    setResult((r) => r && { words: r.words.filter((i) => i.key !== key), fixes: r.fixes.filter((i) => i.key !== key) });
  };

  const added = result ? [...result.words, ...result.fixes].filter((i) => i.isNew).length : 0;
  const empty = result && !result.words.length && !result.fixes.length;

  return (
    <div className="screen chat-summary">
      <TopBar title="Итог диалога" back="Тестовое" onBack={onBack} />
      <div className="stat-tiles">
        <div className="c-sky">
          <b>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </b>
          <span>время</span>
        </div>
        <div className="c-lav">
          <b>{mine.length}</b>
          <span>реплик</span>
        </div>
        <div className="c-mint">
          <b>{result ? added : '…'}</b>
          <span>в словарик</span>
        </div>
        <div className="c-butter">
          <b>+{xp}</b>
          <span>XP</span>
        </div>
      </div>

      {!result && !error && <p className="muted dialog-wait">Разбираю разговор…</p>}
      {error && (
        <div className="dialog-error">
          <p>{error}</p>
          <button className="chunky c-peach" onClick={run}>
            Разобрать ещё раз
          </button>
        </div>
      )}
      {empty && <p className="muted dialog-wait">{mine.length ? 'Ошибок и новых слов не нашлось — отлично!' : 'Твоих реплик не было — разбирать нечего.'}</p>}

      {result && result.words.length > 0 && (
        <>
          <div className="overline" style={{ marginTop: 20 }}>
            Новые слова
          </div>
          {result.words.map((i) => (
            <Row key={i.key} item={i} onRemove={() => remove(i.key)} />
          ))}
        </>
      )}
      {result && result.fixes.length > 0 && (
        <>
          <div className="overline" style={{ marginTop: 20 }}>
            Твои ошибки
          </div>
          {result.fixes.map((i) => (
            <Row key={i.key} item={i} onRemove={() => remove(i.key)} />
          ))}
        </>
      )}
      {added > 0 && <p className="muted small dialog-where">Всё это в Словаре, раздел «🗣️ Из диалогов». Ненужное убери крестиком.</p>}

      <button className="link" style={{ marginTop: 16 }} onClick={onBack}>
        Готово
      </button>
    </div>
  );
}
