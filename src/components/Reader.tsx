import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteText, lemmaKey, linkForm, statusOf, useData } from '../lib/store';
import { parseText, sentenceAt, uniqueForms, type Paragraph } from '../lib/text';
import { translateParagraph, translatePhrase, translateWord } from '../lib/gemini';
import { WordSheet, type SheetState } from './WordSheet';
import { SyncBadge } from './SyncBadge';

interface Props {
  id: string;
  onBack: () => void;
}

type Sel = { p: number; a: number; b: number };
type ParaTr = { loading?: boolean; text?: string; error?: string };

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 10;

export function Reader({ id, onBack }: Props) {
  const data = useData();
  const doc = data.texts[id];
  const paragraphs = useMemo(() => parseText(doc?.content ?? ''), [doc?.content]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [paraTr, setParaTr] = useState<Record<number, ParaTr>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const known = useMemo(() => {
    const forms = uniqueForms(doc?.content ?? '');
    return forms.length ? Math.round((forms.filter((f) => statusOf(data, f) === 'known').length / forms.length) * 100) : 0;
  }, [data, doc?.content]);

  // Gesture state lives in a ref: handlers must see it synchronously
  const g = useRef<{ p: number; t: number; b: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; selecting: boolean; moved: boolean } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Block scrolling only while a phrase is being selected (needs a non-passive listener)
    const onTouchMove = (e: TouchEvent) => {
      if (g.current?.selecting) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  if (!doc || doc.deleted) {
    return (
      <div className="screen">
        <button className="link" onClick={onBack}>
          ‹ Назад
        </button>
        <p>Текст удалён.</p>
      </div>
    );
  }

  const tokenAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-t]');
    return el ? { p: Number(el.dataset.p), t: Number(el.dataset.t) } : null;
  };

  const lookupWord = async (p: Paragraph, t: number) => {
    const tok = p.tokens[t];
    const sentence = sentenceAt(p, tok.start);
    const my = ++reqId.current;
    setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence });
    try {
      const info = await translateWord(tok.text, sentence);
      const key = lemmaKey(info.lemma);
      const w = data.words[key];
      if (w && !w.deleted) linkForm(tok.form, key);
      if (my === reqId.current) setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence, info });
    } catch (e) {
      if (my === reqId.current) setSheet({ kind: 'word', form: tok.form, word: tok.text, sentence, error: (e as Error).message });
    }
  };

  const lookupPhrase = async (s: Sel) => {
    const p = paragraphs[s.p];
    const [a, b] = s.a <= s.b ? [s.a, s.b] : [s.b, s.a];
    if (a === b) return lookupWord(p, a);
    const phrase = p.text.slice(p.tokens[a].start, p.tokens[b].end);
    const sentence = p.text
      .slice(p.sentences.find(([x, y]) => p.tokens[a].start >= x && p.tokens[a].start < y)?.[0] ?? 0, p.sentences.find(([x, y]) => p.tokens[b].start >= x && p.tokens[b].start < y)?.[1] ?? p.text.length)
      .trim();
    const my = ++reqId.current;
    setSheet({ kind: 'phrase', phrase, sentence });
    try {
      const info = await translatePhrase(phrase, sentence);
      if (my === reqId.current) setSheet({ kind: 'phrase', phrase, sentence, info });
    } catch (e) {
      if (my === reqId.current) setSheet({ kind: 'phrase', phrase, sentence, error: (e as Error).message });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const hit = tokenAt(e.clientX, e.clientY);
    if (!hit || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const state = { ...hit, b: hit.t, x: e.clientX, y: e.clientY, selecting: false, moved: false } as NonNullable<typeof g.current>;
    state.timer = setTimeout(() => {
      if (g.current !== state || state.moved) return;
      state.selecting = true;
      setSel({ p: hit.p, a: hit.t, b: hit.t });
    }, LONG_PRESS_MS);
    g.current = state;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s) return;
    if (!s.selecting) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) {
        s.moved = true;
        clearTimeout(s.timer);
      }
      return;
    }
    const hit = tokenAt(e.clientX, e.clientY);
    if (hit && hit.p === s.p && hit.t !== s.b) {
      s.b = hit.t;
      setSel({ p: s.p, a: s.t, b: s.b });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.selecting) {
      void lookupPhrase({ p: s.p, a: s.t, b: s.b });
      return;
    }
    if (s.moved) return;
    const hit = tokenAt(e.clientX, e.clientY);
    if (!hit || hit.p !== s.p || hit.t !== s.t) return;
    setSel({ p: s.p, a: s.t, b: s.t });
    void lookupWord(paragraphs[s.p], s.t);
  };

  const onPointerCancel = () => {
    if (g.current) clearTimeout(g.current.timer);
    g.current = null;
  };

  const translatePara = async (i: number) => {
    if (paraTr[i]?.text) {
      setParaTr((m) => ({ ...m, [i]: {} })); // second tap hides it
      return;
    }
    setParaTr((m) => ({ ...m, [i]: { loading: true } }));
    try {
      const text = await translateParagraph(paragraphs[i].text);
      setParaTr((m) => ({ ...m, [i]: { text } }));
    } catch (e) {
      setParaTr((m) => ({ ...m, [i]: { error: (e as Error).message } }));
    }
  };

  const closeSheet = () => {
    reqId.current++;
    setSheet(null);
    setSel(null);
  };

  const isSelected = (p: number, t: number) => sel && sel.p === p && t >= Math.min(sel.a, sel.b) && t <= Math.max(sel.a, sel.b);

  return (
    <div className={`screen reader-screen ${sheet ? 'with-sheet' : ''}`}>
      <header className="bar sticky">
        <button className="link" onClick={onBack}>
          ‹ Тексты
        </button>
        <span className="muted small">Знаешь {known}%</span>
        <SyncBadge />
      </header>
      <h2 className="reader-title">{doc.title}</h2>
      {doc.source && <p className="text-source">{doc.source}</p>}
      {doc.notes && doc.notes.length > 0 && (
        <details className="critic-notes">
          <summary>Что исправил критик</summary>
          <ul>
            {doc.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div
        ref={containerRef}
        className="reader"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {paragraphs.map((p, pi) => (
          <div key={pi} className="para">
            <p>
              {p.tokens.map((tok, ti) =>
                tok.word ? (
                  <span key={ti} data-p={pi} data-t={ti} className={`w w-${statusOf(data, tok.form)}${isSelected(pi, ti) ? ' sel' : ''}`}>
                    {tok.text}
                  </span>
                ) : (
                  <span key={ti}>{tok.text}</span>
                ),
              )}
            </p>
            <button className="para-btn" onClick={() => void translatePara(pi)}>
              {paraTr[pi]?.loading ? 'Перевожу…' : paraTr[pi]?.text ? 'Скрыть перевод' : 'Перевести абзац'}
            </button>
            {paraTr[pi]?.text && <p className="para-tr">{paraTr[pi].text}</p>}
            {paraTr[pi]?.error && <p className="error small">{paraTr[pi].error}</p>}
          </div>
        ))}
      </div>

      <button
        className="link danger"
        onClick={() => {
          if (confirm('Удалить этот текст? Слова в словаре останутся.')) {
            deleteText(id);
            onBack();
          }
        }}
      >
        Удалить текст
      </button>

      {sheet && (
        <WordSheet
          state={sheet}
          onClose={closeSheet}
          onRetry={() => {
            if (!sel) return;
            void (sheet.kind === 'word' ? lookupWord(paragraphs[sel.p], sel.a) : lookupPhrase(sel));
          }}
        />
      )}
    </div>
  );
}
