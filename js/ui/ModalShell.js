let nextTitleId = 0;

/** Standard panel and accessible title for both hosted and native dialogs. */
export function createModalShell(titleId = `gm-vault-modal-title-${++nextTitleId}`, {
  id, role = 'dialog', descriptionId, native = false, ownerDocument = document
} = {}) {
  const content = ownerDocument.createElement(native ? 'dialog' : 'div');
  content.className = 'modal__content';
  const root = native ? content : ownerDocument.createElement('div');
  if (!native) {
    root.className = 'modal';
    root.setAttribute('role', role);
    root.setAttribute('aria-modal', 'true');
    root.append(content);
  }
  if (id) root.id = id;
  root.setAttribute('aria-labelledby', titleId);
  if (descriptionId) root.setAttribute('aria-describedby', descriptionId);
  return { root, content, titleId };
}
