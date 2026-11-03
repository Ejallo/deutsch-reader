import { useState } from 'react';
import { updateSettings, type MascotId } from '../lib/store';
import { DEFAULT_MASCOT, MASCOTS, Mascot, MascotPicker } from './Mascot';

/** First-run step: pick the tamagotchi that learns along. */
export function MascotStep() {
  const [pick, setPick] = useState<MascotId>(DEFAULT_MASCOT);
  const m = MASCOTS.find((x) => x.id === pick)!;
  return (
    <div className="screen">
      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <Mascot id={pick} size={130} />
        <h1 style={{ marginTop: 14 }}>{m.de}</h1>
        <p className="muted">{m.ru} — будет учить немецкий вместе с тобой. Выбери персонажа, поменять можно в настройках.</p>
      </div>
      <MascotPicker value={pick} onPick={setPick} />
      <button className="chunky c-peach wide" onClick={() => updateSettings({ mascot: pick })}>
        Дальше
      </button>
    </div>
  );
}
