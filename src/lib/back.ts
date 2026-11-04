import { useEffect, useRef } from 'react';

/**
 * System "Back" (Android back button/gesture, browser Back) closes the topmost
 * open sheet or screen instead of leaving the app.
 *
 * While at least one handler is registered we keep one guard entry on top of
 * the browser history. Back pops it, we run the topmost handler and push the
 * guard again if something is still open. With nothing open there is no guard,
 * so Back on the home screen leaves the app as usual.
 */

/** Screens (layer 0) yield to sheets and panels opened on top of them (layer 1). */
export const LAYER_SCREEN = 0;
export const LAYER_SHEET = 1;

interface Entry {
  id: number;
  layer: number;
  run: () => void;
}

const stack: Entry[] = [];
let seq = 0;
let guarded = false; // our guard entry is the current history entry
let skipPop = false; // we are removing the guard ourselves; ignore that popstate
let scheduled = false;

function topmost(): Entry | undefined {
  let best: Entry | undefined;
  for (const e of stack) if (!best || e.layer > best.layer || (e.layer === best.layer && e.id > best.id)) best = e;
  return best;
}

function reconcile() {
  scheduled = false;
  if (skipPop) return; // wait until our own history.back() lands
  const need = stack.length > 0;
  if (need && !guarded) {
    history.pushState({ ...(history.state ?? {}), backGuard: true }, '');
    guarded = true;
  } else if (!need && guarded) {
    guarded = false;
    skipPop = true;
    history.back();
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // After React has finished closing/opening things in this tick
  setTimeout(reconcile, 0);
}

if (typeof window !== 'undefined') {
  // After a reload we may still be sitting on a guard entry from before
  if (history.state?.backGuard) {
    guarded = true;
    schedule();
  }
  window.addEventListener('popstate', () => {
    if (skipPop) {
      skipPop = false;
      schedule();
      return;
    }
    if (!guarded) return; // not ours: real navigation away
    guarded = false;
    topmost()?.run();
    schedule();
  });
}

/** While `active`, system Back calls `onBack` (the latest one passed). */
export function useBack(active: boolean, onBack: () => void, layer: number = LAYER_SHEET) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { id: ++seq, layer, run: () => ref.current() };
    stack.push(entry);
    schedule();
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      schedule();
    };
  }, [active, layer]);
}
