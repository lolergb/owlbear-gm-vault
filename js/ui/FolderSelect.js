import { ModalSelect } from './ModalSelect.js';

/** Folder fields add paths and the folder icon to the shared modal selector. */
export class FolderSelect extends ModalSelect {
  constructor(select, field = {}) {
    super(select, { label: 'Folder', resultLabel: 'folder', icon: 'img/folder-close.svg', ...field });
  }
}
