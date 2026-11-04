import { useEffect, useState } from 'react';
import { makeChunk, translateParagraph, type ChunkInfo, type PhraseInfo, type WordInfo } from '../lib/gemini';
import { addXp, lemmaKey, removeWord, saveChunk, saveWord, useData, wordForForm, type WordStatus } from '../lib/store';
import { articleClass } from './ui';
import { speak } from '../lib/tts';
import { useBack } from '../lib/back';

export type SheetState =
  | { kind: 'word'; form: string; word: string; sentence: string; info?: WordInfo; error?: string }
  | { kind: 'phrase'; phrase: string; sentence: string; info?: PhraseInfo; error?: string };

interface Props {
  state: SheetState;
  source?: string; // title of the text, remembered on saved chunks
  onClose: () => void;
  onRetry: () => void;
}

export function WordSheet({ state, source, onClose, onRetry }: Props) {
  useBack(true, onClose);
  return (
    <div className="sheet" role="dialog" aria-label="Перевод">
      <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      {state.kind === 'word' ? <WordBody state={state} /> : <PhraseBody state={state} />}
      {state.info && <ChunkMaker key={state.kind === 'word' ? state.word : state.phrase} hint={state.kind === 'word' ? state.word : state.phrase} sentence={state.sentence} source={source} />}
      <SentenceTools sentence={state.sentence} />
      {state.error && (
        <div>
          <p className="error">{state.error}</p>
          <button className="chunky c-card" onClick={onRetry}>
            Повторить
          </button>
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

  const set = (status: WordStatus) => {
    // Saving a new word to learn earns a little XP
    if (status === 'learning' && !saved) addXp(5);
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
  };

  return (
    <>
      <div className="sheet-head">
        {info.article && <span className={`pill art-pill ${articleClass(info.article)}`}>{info.article}</span>}
        <span className="sheet-word">{info.lemma}</span>
        <button className="speak" onClick={() => speak(full)} aria-label="Озвучить">
          🔊
        </button>
      </div>
      <p className="sheet-tr">{info.translation}</p>
      <p className="muted small" style={{ margin: 0 }}>
        {[info.pos, info.plural && `мн. ч. ${info.plural}`, info.lemmaTranslation && `значения: ${info.lemmaTranslation}`].filter(Boolean).join(' · ')}
      </p>
      {info.note && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {info.note}
        </p>
      )}

      <div className="sheet-actions">
        {!saved && (
          <>
            <button className="chunky c-peach" onClick={() => set('learning')}>
              + В словарь <span className="xp">+5 XP</span>
            </button>
            <button className="chunky c-card" style={{ flex: '0 0 auto' }} onClick={() => set('known')}>
              Знаю
            </button>
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
        <button className="speak" onClick={() => speak(state.phrase)} aria-label="Озвучить">
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

/** Builds a chunk around the selection with Gemini, shows a preview, saves it to the deck. */
function ChunkMaker({ hint, sentence, source }: { hint: string; sentence: string; source?: string }) {
  const data = useData();
  const [st, setSt] = useState<{ loading?: boolean; info?: ChunkInfo; error?: string; saved?: string }>({});

  // While another variant loads the current one stays on screen, and stays if the request fails
  const build = async (another = false) => {
    const prev = st.info;
    setSt({ info: prev, loading: true });
    try {
      setSt({ info: await makeChunk(hint, sentence, another ? prev : undefined) });
    } catch (e) {
      setSt({ info: prev, error: (e as Error).message });
    }
  };

  const save = () => {
    if (!st.info) return;
    addXp(5);
    const { text, translation, note, examples } = st.info;
    setSt({ ...st, saved: saveChunk({ text, translation, note, examples, source, status: 'learning' }) });
  };

  const existing = st.info ? data.chunks[lemmaKey(st.info.text)] : undefined;
  const inDeck = !!st.saved || (!!existing && !existing.deleted);

  if (!st.info) {
    return (
      <div className="chunk-maker">
        <button className="chunky c-lav" onClick={() => void build()} disabled={st.loading}>
          {st.loading ? 'Собираю чанк…' : '🧩 Учить чанком'}
        </button>
        {st.error && <p className="error small">{st.error}</p>}
      </div>
    );
  }

  return (
    <div className="chunk-maker chunk-preview">
      <span className="chunk-label">Чанк</span>
      <div className="sheet-head">
        <span className="sheet-word phrase">{st.info.text}</span>
        <button className="speak" onClick={() => speak(st.info!.text)} aria-label="Озвучить">
          🔊
        </button>
      </div>
      <p className="sheet-tr">{st.info.translation}</p>
      {st.info.note && <p className="muted small" style={{ margin: 0 }}>{st.info.note}</p>}
      {st.info.examples.map((e, n) => {
        const i = e.de.indexOf(e.gap);
        return (
          <p key={n} className="feed-example" style={{ margin: 0 }}>
            „{e.de.slice(0, i)}
            <b>{e.gap}</b>
            {e.de.slice(i + e.gap.length)}“
          </p>
        );
      })}
      {st.error && <p className="error small">{st.error}</p>}
      <div className="sheet-actions">
        {inDeck ? (
          <span className="tag tag-learning">Чанк в колоде</span>
        ) : (
          <>
            <button className="chunky c-peach" onClick={save} disabled={st.loading}>
              + В колоду <span className="xp">+5 XP</span>
            </button>
            <button className="link" onClick={() => void build(true)} disabled={st.loading}>
              {st.loading ? 'Ищу другой…' : 'Другой вариант'}
            </button>
          </>
        )}
      </div>
    </div>
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
