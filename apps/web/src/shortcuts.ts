import { useEffect, useState } from 'react';

// Single-key shortcuts can be turned off (WCAG 2.1.4): a person using speech input or a sticky keyboard should not
// approve, reject or switch views by accident. On by default, remembered in this browser.
const KEY = 'stint.single-keys';
const EVENT = 'stint:single-keys';

export function singleKeysOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSingleKeys(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private window: the choice lasts for this tab only */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Whether single-key shortcuts are on, following a switch made anywhere on the page. */
export function useSingleKeys(): boolean {
  const [on, set] = useState(singleKeysOn);
  useEffect(() => {
    const follow = () => set(singleKeysOn());
    window.addEventListener(EVENT, follow);
    return () => window.removeEventListener(EVENT, follow);
  }, []);
  return on;
}

/** True when a plain key press may act as a shortcut: they are on, no modifier is held, and focus is not in a field. */
export function singleKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || !singleKeysOn()) return false;
  const t = e.target;
  return !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable));
}
