import { useState } from 'react';
import { GRAMMAR_SETTLED, grammarCards, saveGrammarLesson, snoozeGrammarTopic, topicStatus, topicWaiting, useData, weakTopic, type Chunk, type ChunkExample, type TopicStatus } from '../lib/store';
import { buildCards, TOPICS, topicById } from '../lib/grammar';
import { makeGrammarLesson, type GrammarStage } from '../lib/gemini';
import { TopBar } from './ui';

// Grammar topics: the list, and one topic's lesson. Practice itself happens in the feed.

const STATUS: Record<TopicStatus, [string, string]> = {
  new: ['новая', 'c-sky'],
  learning: ['учу', 'c-butter'],
  learned: ['усвоена', 'c-mint'],
};

const LADDER_NAMES = ['выбор', 'плитки', 'ввод', 'своё предложение'];
const OWN_SENTENCE_STABILITY = 21;

/** How far a card has climbed: choose -> tiles -> type -> own sentence. */
function ladderStep(c: Chunk | undefined): number {
  if (!c?.card?.reps) return 0;
  if (c.card.stability >= OWN_SENTENCE_STABILITY) return 3;
  return c.card.stability >= GRAMMAR_SETTLED ? 2 : 1;
}

const mistakes = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'ошибка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'ошибки' : 'ошибок'}`;

/** Offers the topic that keeps going wrong in real speech and writing. */
export function WeakTopicCard({ onOpen }: { onOpen: (id: string) => void }) {
  const weak = weakTopic(useData());
  const t = topicById(weak?.id);
  if (!weak || !t) return null;
  return (
    <div className="gram-weak">
      <b>
        {t.emoji} Проседает тема «{t.title}»
      </b>
      <span>{mistakes(weak.misses)} за неделю. Потренируем эту тему?</span>
      <div className="gram-weak-actions">
        <button className="chunky c-peach" onClick={() => onOpen(t.id)}>
          Учить тему
        </button>
        <button className="chunky c-card" onClick={() => snoozeGrammarTopic(t.id)}>
          Не сейчас
        </button>
      </div>
    </div>
  );
}

export function GrammarList({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const data = useData();
  const due = TOPICS.filter((t) => topicStatus(data, t.id) !== 'new' && topicWaiting(data, t.id) > 0).length;
  return (
    <div className="screen">
      <TopBar title="Грамматика" back="Тестовое" onBack={onBack} />
      <p className="muted" style={{ fontWeight: 600 }}>
        {due ? `Ждут повторения: ${due}` : 'Выбери тему. Усвоенные темы сами приходят в общую ленту.'}
      </p>
      <WeakTopicCard onOpen={onOpen} />
      {(['A2', 'B1'] as const).map((level) => (
        <div key={level}>
          <div className="overline" style={{ marginTop: 18 }}>
            {level}
          </div>
          {TOPICS.filter((t) => t.level === level).map((t) => {
            const status = topicStatus(data, t.id);
            const waiting = status === 'new' ? 0 : topicWaiting(data, t.id);
            return (
              <button key={t.id} className="gram-row" onClick={() => onOpen(t.id)}>
                <span className="gram-ic">{t.emoji}</span>
                <span className="gram-txt">
                  <b>{t.title}</b>
                  <small>{t.summary}</small>
                </span>
                {waiting > 0 && <span className="gram-due">{waiting}</span>}
                <span className={`pill sm ${STATUS[status][1]}`}>{STATUS[status][0]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A sentence with the tested word picked out. */
function Marked({ e }: { e: ChunkExample }) {
  const i = e.de.indexOf(e.gap);
  return (
    <p className="gram-ex">
      {e.de.slice(0, i)}
      <mark>{e.gap}</mark>
      {e.de.slice(i + e.gap.length)}
      <small>{e.ru}</small>
    </p>
  );
}

export function GrammarTopicScreen({ id, onBack, onTrain }: { id: string; onBack: () => void; onTrain: () => void }) {
  const data = useData();
  const [busy, setBusy] = useState<GrammarStage | null>(null);
  const [error, setError] = useState('');
  const t = topicById(id);
  if (!t) return null;

  const cards = grammarCards(data, t.id);
  const state = data.grammar?.[t.id];
  const status = topicStatus(data, t.id);
  const waiting = topicWaiting(data, t.id);
  const hasKey = !!data.settings.geminiKey;
  const cardOf = (key: string) => cards.find((c) => c.item === key);

  const write = async () => {
    setError('');
    setBusy('writing');
    try {
      const lesson = await makeGrammarLesson(t, setBusy);
      saveGrammarLesson(t.id, lesson.intro, lesson.ruNote, buildCards(t, lesson.cards));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Without a key the hand-written examples are still enough to start practising
  const startWithoutKey = () => {
    const base = buildCards(t);
    saveGrammarLesson(t.id, '', '', base);
    onTrain();
  };

  return (
    <div className="screen">
      <TopBar title={`${t.emoji} ${t.title}`} back="Грамматика" onBack={onBack} right={<span className={`pill sm ${STATUS[status][1]}`}>{STATUS[status][0]}</span>} />

      {state?.intro ? <p className="gram-intro">{state.intro}</p> : <p className="muted">{t.summary}</p>}
      {state?.ruNote && <p className="gram-note">🇷🇺 {state.ruNote}</p>}

      <table className="gram-table">
        <thead>
          <tr>
            <th>{t.head[0]}</th>
            <th>{t.head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {t.table.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {t.items.map((i) => {
        const c = cardOf(i.key);
        const step = ladderStep(c);
        return (
          <div key={i.key} className="gram-item">
            <div className="gram-item-head">
              <b>{i.label}</b>
              <span>{i.ru}</span>
              {c && (
                <span className="gram-dots" title={`Сейчас: ${LADDER_NAMES[step]}`} aria-label={`Ступень: ${LADDER_NAMES[step]}`}>
                  {LADDER_NAMES.map((n, k) => (
                    <i key={n} className={k <= step ? 'on' : ''} />
                  ))}
                </span>
              )}
            </div>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              {i.rule}
            </p>
            <Marked e={(c ?? { examples: [i.example] }).examples[0]} />
            {c?.examples.some((e) => e.own) && <small className="gram-own">есть предложение из твоего текста</small>}
          </div>
        );
      })}

      {error && <p className="error">{error}</p>}
      <div className="gram-cta">
        {cards.length > 0 ? (
          <button className="chunky c-peach wide" onClick={onTrain}>
            ▶ Тренировать{waiting > 0 ? ` · ${waiting}` : ''}
          </button>
        ) : hasKey ? (
          <button className="chunky c-peach wide" disabled={!!busy} onClick={() => void write()}>
            {busy === 'writing' ? 'Пишу урок и примеры…' : busy === 'checking' ? 'Критик сверяет с эталоном…' : '✦ Подготовить урок'}
          </button>
        ) : (
          <button className="chunky c-peach wide" onClick={startWithoutKey}>
            ▶ Начать с базовыми примерами
          </button>
        )}
        {cards.length > 0 && !state?.intro && hasKey && (
          <button className="link" disabled={!!busy} onClick={() => void write()}>
            {busy === 'writing' ? 'Пишу урок и примеры…' : busy === 'checking' ? 'Критик сверяет с эталоном…' : '✦ Написать урок и добавить примеры'}
          </button>
        )}
        {busy && <p className="muted small">Обычно это занимает до минуты.</p>}
        {!hasKey && <p className="muted small">С ключом Gemini появятся объяснение, больше примеров и задание «своё предложение».</p>}
      </div>
    </div>
  );
}
