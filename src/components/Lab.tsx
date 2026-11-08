import { TopBar } from './ui';

// Features still being tried out.
export function Lab({ onBack, onDialog, onGrammar }: { onBack: () => void; onDialog: () => void; onGrammar: () => void }) {
  return (
    <div className="screen">
      <TopBar title="🧪 Тестовое" back="Главная" onBack={onBack} />
      <p className="muted" style={{ fontWeight: 600 }}>
        Новые функции на обкатке. Они могут меняться или исчезнуть — расскажи, что понравилось.
      </p>
      <button className="lab-item c-mint-item" onClick={onDialog}>
        <span className="lab-ic">🗣️</span>
        <div>
          <b>Диалог с ИИ</b>
          <span>Живой разговор голосом. Ошибки и новые слова после звонка сами попадают в словарик.</span>
        </div>
      </button>
      <button className="lab-item" onClick={onGrammar}>
        <span className="lab-ic">📐</span>
        <div>
          <b>Грамматика</b>
          <span>Коннекторы, Perfekt, падежи и другое: короткое правило и тренировка в ленте.</span>
        </div>
      </button>
    </div>
  );
}
