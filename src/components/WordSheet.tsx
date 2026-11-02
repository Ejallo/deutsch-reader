import { useEffect, useState } from 'react';
import { translateParagraph, type PhraseInfo, type WordInfo } from '../lib/gemini';
import { lemmaKey, removeWord, saveWord, useData, wordForForm, type WordStatus } from '../lib/store';
import { speak } from '../lib/tts';

export type SheetState =
  | { kind: 'word'; form: string; word: string; sentence: string; info?: WordInfo; error?: string }
  | { kind: 'phrase'; phrase: string; sentence: string; info?: PhraseInfo; error?: string };

interface Props {
  state: SheetState;
  onClose: () => void;
  onRetry: () => void;
}

export function WordSheet({ state, onClose, onRetry }: Props) {
  return (
    <div className="sheet" role="dialog" aria-label="Перевод">
      <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      {state.kind === 'word' ? <WordBody state={state} /> : <PhraseBody state={state} />}
      <SentenceTools sentence={state.sentence} />
      {state.error && (
        <div>
          <p className="error">{state.error}</p>
          <button onClick={onRetry}>Повторить</button>
        </div>
      )}
    </div>
  );
}

function WordBody({ state }: { state: Extract<SheetState, { kind: 'word' }> }) {
  const data = useData();
  const { info } = state;

  if (!info) {
    return (
      <div className="sheet-head">
        <span className="sheet-word">{state.word}</span>
        {!state.error && <span className="muted">Перевожу…</span>}
      </div>
    );
  }

  const key = lemmaKey(info.lemma);
  const saved = wordForForm(data, state.form) ?? (data.words[key] && !data.words[key].deleted ? data.words[key] : null);
  const full = info.article ? `${info.article} ${info.lemma}` : info.lemma;

  const set = (status: WordStatus) =>
    saveWord(state.form, {
      lemma: info.lemma,
      article: info.article,
      plural: info.plural,
      pos: info.pos,
      translation: info.translation,
      meanings: info.lemmaTranslation,
      note: info.note,
      example: state.sentence,
      status,
    });

  return (
    <>
      <div className="sheet-head">
        <span className="sheet-word">{full}</span>
        <button className="icon-btn" onClick={() => speak(full)} aria-label="Озвучить">
          🔊
        </button>
      </div>
      <p className="muted small">
        {[info.pos, info.plural && `мн. ${info.plural}`].filter(Boolean).join(' · ')}
      </p>
      <p className="sheet-tr">{info.translation}</p>
      {info.lemmaTranslation && <p className="small">Значения: {info.lemmaTranslation}</p>}
      {info.note && <p className="muted small">{info.note}</p>}

      <div className="sheet-actions">
        {!saved && (
          <>
            <button className="primary" onClick={() => set('learning')}>
              Учить
            </button>
            <button onClick={() => set('known')}>Знаю</button>
          </>
        )}
        {saved?.status === 'learning' && (
          <>
            <span className="tag tag-learning">Изучаешь</span>
            <button onClick={() => set('known')}>Знаю</button>
            <button className="link" onClick={() => removeWord(saved.id)}>
              Убрать
            </button>
          </>
        )}
        {saved?.status === 'known' && (
          <>
            <span className="tag tag-known">Знаешь</span>
            <button onClick={() => set('learning')}>Учить заново</button>
            <button className="link" onClick={() => removeWord(saved.id)}>
              Убрать
            </button>
          </>
        )}
      </div>
    </>
  );
}

function PhraseBody({ state }: { state: Extract<SheetState, { kind: 'phrase' }> }) {
  return (
    <>
      <div className="sheet-head">
        <span className="sheet-word phrase">{state.phrase}</span>
        <button className="icon-btn" onClick={() => speak(state.phrase)} aria-label="Озвучить">
          🔊
        </button>
      </div>
      {state.info ? (
        <>
          <p className="sheet-tr">{state.info.translation}</p>
          {state.info.note && <p className="muted small">{state.info.note}</p>}
        </>
      ) : (
        !state.error && <p className="muted">Перевожу…</p>
      )}
    </>
  );
}

/** Whole-sentence help under any word: listen to it or see its translation. */
function SentenceTools({ sentence }: { sentence: string }) {
  const [tr, setTr] = useState<{ loading?: boolean; text?: string; error?: string }>({});
  useEffect(() => setTr({}), [sentence]);

  const translate = async () => {
    setTr({ loading: true });
    try {
      setTr({ text: await translateParagraph(sentence) });
    } catch (e) {
      setTr({ error: (e as Error).message });
    }
  };

  return (
    <div className="sentence-tools">
      <div className="row">
        <button className="para-btn" onClick={() => speak(sentence)}>
          🔊 Предложение
        </button>
        {!tr.text && (
          <button className="para-btn" onClick={() => void translate()} disabled={tr.loading}>
            {tr.loading ? 'Перевожу…' : 'Перевод предложения'}
          </button>
        )}
      </div>
      {tr.text && <p className="para-tr">{tr.text}</p>}
      {tr.error && <p className="error small">{tr.error}</p>}
    </div>
  );
}
