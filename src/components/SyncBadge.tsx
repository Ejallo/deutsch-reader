import { syncNow, useSync } from '../lib/sync';

export function SyncBadge() {
  const s = useSync();
  if (s.status === 'off') return null;
  const label = s.status === 'syncing' ? 'Синхронизация…' : s.status === 'error' ? s.error : 'Синхронизировано';
  return (
    <button className={`sync-dot sync-${s.status}`} onClick={() => void syncNow()} title={label} aria-label={label}>
      <span />
    </button>
  );
}
