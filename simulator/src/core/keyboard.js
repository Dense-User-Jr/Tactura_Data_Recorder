/**
 * Shared keyboard helpers for every key handler in the sim
 * (HUD shortcuts now, gesture keys and camera keys later).
 */

/**
 * True when the key event should be left to a text field (settings panel).
 * @param {EventTarget | null} target
 */
export function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select');
}

/**
 * True when a global shortcut should handle this event: not typing in a field,
 * and no Ctrl/Cmd/Alt held (so browser shortcuts like Ctrl+R keep working).
 * @param {KeyboardEvent} e
 */
export function isShortcutEvent(e) {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target);
}
