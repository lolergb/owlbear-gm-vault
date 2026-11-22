// A partial redraw of a transparent action iframe can leave the old toolbar
// rectangle over Owlbear's blurred map. Include the tint in the same frame.
export function watchListPanelBackdrop(list) {
  const root = list?.ownerDocument.documentElement;
  if (!root?.classList.contains('embedded-action')) return;

  const win = list.ownerDocument.defaultView;
  const control = '.list-row-tools button, .page-button, .category-title-container';
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout'];
  let frame = null;

  function refresh(event) {
    const from = event.relatedTarget?.closest?.(control) ?? null;
    const to = event.target.closest(control);
    if (from === to || frame !== null) return;

    frame = win.requestAnimationFrame(() => {
      frame = null;
      root.classList.toggle('refresh-list-backdrop');
    });
  }

  for (const type of events) list.addEventListener(type, refresh);
  return () => {
    for (const type of events) list.removeEventListener(type, refresh);
    if (frame !== null) win.cancelAnimationFrame(frame);
    root.classList.remove('refresh-list-backdrop');
  };
}
