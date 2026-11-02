import { useState } from 'react';
import { makeChunk } from '../lib/gemini';
import { addXp, getData, lemmaKey, liveChunks, saveChunk, type ChunkExample } from '../lib/store';

interface Props {
  onClose: () => void;
}

const FALLBACK_VERBS = ['machen', 'haben', 'geben', 'nehmen', 'stellen', 'legen', 'bringen', 'halten', 'sagen', 'gehen'];
const FALLBACK_NOUNS = ['Zeit', 'Angst', 'Hunger', 'Spaß', 'Ruhe', 'Glück', 'Recht', 'Durst', 'Platz', 'Bescheid'];
// Articles and determiners make a pointless gap
const FUNCTION_WORD = /^(d(er|ie|as|en|em|es)|k?ein(e[mnrs]?)?|mein(e[mnrs]?)?|dein(e[mnrs]?)?|sein(e[mnrs]?)?|ihr(e[mnrs]?)?|zu|zum|zur)$/i;

const isNoun = (w: string) => /^[A-ZÄÖÜ]/.test(w);

/** Without Gemini: hide the longest content word of the chunk found in the sentence; distractors of the same kind. */
function manualExample(text: string, sentence: string, ru: string): ChunkExample {
  const de = sentence || text;
  const words = text.split(/\s+/).map((w) => w.replace(/[.,!?;:]/g, '')).filter(Boolean);
  const content = words.filter((w) => !FUNCTION_WORD.test(w));
  const candidates = (content.length ? content : words).filter((w) => de.includes(w));
  const gap = [...(candidates.length ? candidates : content.length ? content : words)].sort((a, b) => b.length - a.length)[0];
  const sameKind = (w: string) => isNoun(w) === isNoun(gap) && w.toLowerCase() !== gap.toLowerCase();
  const fromDeck = liveChunks(getData()).flatMap((c) => c.examples.map((e) => e.gap));
  const pool = [...new Set([...fromDeck, ...(isNoun(gap) ? FALLBACK_NOUNS : FALLBACK_VERBS)])].filter(sameKind);
  const wrong = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  return { de: de.includes(gap) ? de : text, ru: sentence ? '' : ru, gap, wrong };
}

/** Add a chunk by hand; Gemini normalizes it and writes practice sentences. */
export function AddChunkSheet({ onClose }: Props) {
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [sentence, setSentence] = useState('');
  const [note, setNote] = useState('');
  const [examples, setExamples] = useState<ChunkExample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const autofill = async () => {
    const t = text.trim();
    if (!t) return setError('Сначала напиши фразу');
    setBusy(true);
    setError('');
    try {
      const r = await makeChunk(t, sentence.trim(), examples.length ? { text: t, translation, note, examples } : undefined);
      setText(r.text);
      setTranslation(r.translation);
      setNote(r.note);
      setExamples(r.examples);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const t = text.trim();
    if (!t) return setError('Напиши фразу');
    if (!translation.trim()) return setError('Добавь перевод — или нажми «Заполнить через ИИ»');
    const existing = getData().chunks[lemmaKey(t)];
    if (existing && !existing.deleted && !confirm(`«${t}» уже есть в чанках. Заменить?`)) return;
    if (!existing || existing.deleted) addXp(5);
    saveChunk({
      text: t,
      translation: translation.trim(),
      note,
      examples: examples.length ? examples : [manualExample(t, sentence.trim(), translation.trim())],
      status: 'learning',
    });
    onClose();
  };

  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Добавить чанк">
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="sheet-word">Добавить чанк</div>

        <label className="field">
          <span>Фраза по-немецки</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setExamples([]);
              setError('');
            }}
            placeholder="einen Termin vereinbaren"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Перевод</span>
          <input
            value={translation}
            onChange={(e) => {
              setTranslation(e.target.value);
              setError('');
            }}
            placeholder="записаться на приём"
          />
        </label>

        <label className="field">
          <span>Пример (необязательно)</span>
          <input
            value={sentence}
            onChange={(e) => {
              setSentence(e.target.value);
              setExamples([]);
            }}
            placeholder="Ich möchte einen Termin beim Arzt vereinbaren."
            autoCapitalize="off"
          />
        </label>

        {examples.length > 0 && (
          <div className="chunk-preview">
            <span className="chunk-label">Примеры для тренировки</span>
            {note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}
            {examples.map((e, i) => {
              const at = e.de.indexOf(e.gap);
              return (
                <p key={i} className="feed-example" style={{ margin: 0 }}>
                  „{e.de.slice(0, at)}
                  <b>{e.gap}</b>
                  {e.de.slice(at + e.gap.length)}“ <span className="small">— {e.ru}</span>
                </p>
              );
            })}
          </div>
        )}
        {!examples.length && <p className="muted small">ИИ поправит фразу и напишет 3 примера для карточек. Без него карточки будут только по твоему примеру.</p>}

        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button className="chunky c-card" onClick={() => void autofill()} disabled={busy}>
            {busy ? 'Заполняю…' : examples.length ? '✦ Другие примеры' : '✦ Заполнить через ИИ'}
          </button>
          <button className="chunky c-peach" onClick={save}>
            + В чанки
          </button>
        </div>
      </div>
    </>
  );
}
