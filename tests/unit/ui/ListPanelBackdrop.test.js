import { afterEach, expect, it, jest } from '@jest/globals';
import { watchListPanelBackdrop } from '../../../js/ui/ListPanelBackdrop.js';

const root = document.documentElement;
let stop;
afterEach(() => {
  stop?.();
  root.classList.remove('embedded-action');
  document.body.replaceChildren();
  jest.useRealTimers();
});

it('refreshes once when crossing rows, and stays idle within a row or after cleanup', () => {
  jest.useFakeTimers();
  root.classList.add('embedded-action');
  document.body.innerHTML = '<main><button class="page-button"><span>A</span></button><div class="category-title-container">B</div></main>';
  const list = document.querySelector('main');
  const [page, folder] = list.children;
  const refreshed = () => root.classList.contains('refresh-list-backdrop');
  const cross = (from, to) => {
    from.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: from }));
    jest.runOnlyPendingTimers();
  };

  stop = watchListPanelBackdrop(list);
  cross(page, folder);
  expect(refreshed()).toBe(true);
  cross(folder, page);
  expect(refreshed()).toBe(false);
  cross(page, page.firstElementChild);
  expect(refreshed()).toBe(false);
  folder.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: page }));
  stop();
  jest.runOnlyPendingTimers();
  cross(page, folder);
  expect(refreshed()).toBe(false);
});
