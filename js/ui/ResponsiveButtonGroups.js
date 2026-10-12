const GROUPS = '.form__actions, .modal-buttons, .cookie-consent-actions';
const PRIMARY = '.btn--primary, .btn--danger, .modal-button-submit, .modal-button-danger';

/** Keep keyboard order in sync with primary-first mobile / primary-last desktop. */
export function watchResponsiveButtonGroups(root) {
  const view = root.ownerDocument.defaultView;
  if (!view?.matchMedia) return () => {};
  // Keep this breakpoint aligned with the action-group rules in app.css.
  const layout = view.matchMedia('(max-width: 480px)');

  const arrange = group => {
    const children = Array.from(group.children);
    const primary = children.filter(child => child.matches(PRIMARY));
    const secondary = children.filter(child => !child.matches(PRIMARY));
    const ordered = layout.matches ? [...primary, ...secondary] : [...secondary, ...primary];
    if (ordered.every((child, index) => child === children[index])) return;
    const focused = root.ownerDocument.activeElement;
    ordered.forEach((child, index) => {
      if (group.children[index] !== child) group.insertBefore(child, group.children[index]);
    });
    if (group.contains(focused)) focused.focus({ preventScroll: true });
  };

  const arrangeAll = () => root.querySelectorAll(GROUPS).forEach(arrange);
  const observer = new view.MutationObserver(records => {
    const groups = new Set();
    records.forEach(record => {
      if (record.target.matches?.(GROUPS)) groups.add(record.target);
      record.addedNodes.forEach(node => {
        if (node.matches?.(GROUPS)) groups.add(node);
        node.querySelectorAll?.(GROUPS).forEach(group => groups.add(group));
      });
    });
    groups.forEach(group => { if (root.contains(group)) arrange(group); });
  });

  arrangeAll();
  observer.observe(root, { childList: true, subtree: true });
  layout.addEventListener('change', arrangeAll);
  return () => {
    observer.disconnect();
    layout.removeEventListener('change', arrangeAll);
  };
}
