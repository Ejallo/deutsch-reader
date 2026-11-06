import { useState } from 'react';
import { addXp, getData, lemmaKey, saveWord } from '../lib/store';
import { translatePhrase, translateWord } from '../lib/gemini';
import { useBack } from '../lib/back';

interface Props {
  onClose: () => void;
  deck?: string; // section the word goes to (the one open in the dictionary)
}

const ARTICLES = ['', 'der', 'die', 'das'];

/** Add a word or a phrase to the dictionary by hand; Gemini can fill in the details. */
export function AddWordSheet({ onClose, deck }: Props) {
  useBack(true, onClose);
  const [phrase, setPhrase] = useState(false);
  const [german, setGerman] = useState('');
  const [article, setArticle] = useState('');
  const [plural, setPlural] = useState('');
  const [translation, setTranslation] = useState('');
  const [example, setExample] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const autofill = async () => {
    const text = german.trim();
    if (!text) return setError(phrase ? 'Сначала напиши фразу' : 'Сначала напиши слово');
    setBusy(true);
    setError('');
    try {
      if (phrase) {
        const r = await translatePhrase(text, example.trim() || text);
        setTranslation(r.translation);
      } else {
        const r = await translateWord(text, example.trim() || text);
        setGerman(r.lemma);
        setArticle(r.article);
        setPlural(r.plural);
        setTranslation(r.lemmaTranslation || r.translation);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const lemma = german.trim().replace(/^(der|die|das)\s+/i, '');
    if (!lemma) return setError(phrase ? 'Напиши фразу' : 'Напиши слово');
    if (!translation.trim()) return setError('Добавь перевод — или нажми «Заполнить через ИИ»');
    const existing = getData().words[lemmaKey(lemma)];
    if (existing && !existing.deleted && !confirm(`«${lemma}» уже есть в словаре. Заменить?`)) return;
    if (!existing || existing.deleted) addXp(5);
    saveWord(lemmaKey(lemma), {
      lemma,
      article: phrase ? '' : article,
      plural: phrase ? '' : plural.trim(),
      pos: phrase ? 'фраза' : article ? 'сущ.' : '',
      translation: translation.trim(),
      meanings: phrase ? '' : translation.trim(),
      note: '',
      example: example.trim(),
      status: 'learning',
      ...(deck ? { deck } : {}),
    });
    onClose();
  };

  return (
    <>
      <button className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Добавить в словарь">
        <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="sheet-word">Добавить в словарь</div>

        <label className="toggle" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={phrase} onChange={(e) => setPhrase(e.target.checked)} />
          <span>Добавить фразу</span>
        </label>

        <label className="field">
          <span>{phrase ? 'Фраза по-немецки' : 'Слово по-немецки'}</span>
          <input
            value={german}
            onChange={(e) => {
              setGerman(e.target.value);
              setError('');
            }}
            placeholder={phrase ? 'keine Lust haben' : 'Hund'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {!phrase && (
          <div className="field">
            <span>Артикль</span>
            <div className="chips" style={{ margin: 0 }}>
              {ARTICLES.map((a) => (
                <button key={a || 'none'} className={`chip ${article === a ? 'on' : ''}`} onClick={() => setArticle(a)}>
                  {a || 'без артикля'}
                </button>
              ))}
            </div>
          </div>
        )}

        {!phrase && article && (
          <label className="field">
            <span>Множественное число (необязательно)</span>
            <input value={plural} onChange={(e) => setPlural(e.target.value)} placeholder="die Hunde" autoCapitalize="off" />
          </label>
        )}

        <label className="field">
          <span>Перевод</span>
          <input
            value={translation}
            onChange={(e) => {
              setTranslation(e.target.value);
              setError('');
            }}
            placeholder={phrase ? 'не хотеть' : 'собака'}
          />
        </label>

        <label className="field">
          <span>Пример (необязательно)</span>
          <input value={example} onChange={(e) => setExample(e.target.value)} placeholder="Ich habe heute keine Lust." autoCapitalize="off" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button className="chunky c-card" onClick={() => void autofill()} disabled={busy}>
            {busy ? 'Заполняю…' : '✦ Заполнить через ИИ'}
          </button>
          <button className="chunky c-peach" onClick={save}>
            + В словарь
          </button>
        </div>
      </div>
    </>
  );
}
