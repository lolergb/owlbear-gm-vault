const successTimers = new WeakMap();

export const SHARE_BUSY_MIN_MS = 400;
export const SHARE_SUCCESS_MS = 1600;

function wait(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setButtonLabel(button, label) {
  button.title = label;
  button.setAttribute('aria-label', label);
}

/**
 * Run a share action with a browser-stable visual lifecycle.
 *
 * The minimum busy duration is intentional: a broadcast can resolve inside a
 * single rendering frame, which makes Chromium-based browsers skip painting
 * the busy state altogether.
 */
export async function runShareButtonAction(button, action, {
  keepVisibleElement = null,
  busyLabel = 'Sharing…',
  successLabel = 'Shared with players',
  minBusyMs = SHARE_BUSY_MIN_MS,
  successMs = SHARE_SUCCESS_MS
} = {}) {
  if (
    !button ||
    typeof action !== 'function' ||
    button.disabled ||
    button.getAttribute('aria-busy') === 'true'
  ) {
    return false;
  }

  const previousTimer = successTimers.get(button);
  if (previousTimer) {
    clearTimeout(previousTimer);
    successTimers.delete(button);
  }

  const idleLabel = button.dataset.shareIdleLabel || button.title || 'Share with players';
  button.dataset.shareIdleLabel = idleLabel;
  button.classList.remove('shared');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  keepVisibleElement?.classList.add('share-state-visible');
  setButtonLabel(button, busyLabel);

  const startedAt = Date.now();
  let result = false;
  let thrownError = null;

  try {
    result = await action();
  } catch (error) {
    thrownError = error;
  }

  const elapsed = Date.now() - startedAt;
  await wait(Math.max(0, minBusyMs - elapsed));

  button.disabled = false;
  button.removeAttribute('aria-busy');

  const succeeded = !thrownError && result !== false;
  if (succeeded) {
    button.classList.add('shared');
    setButtonLabel(button, successLabel);

    const timer = setTimeout(() => {
      button.classList.remove('shared');
      keepVisibleElement?.classList.remove('share-state-visible');
      setButtonLabel(button, idleLabel);
      successTimers.delete(button);
    }, Math.max(0, successMs));
    successTimers.set(button, timer);
  } else {
    button.classList.remove('shared');
    keepVisibleElement?.classList.remove('share-state-visible');
    setButtonLabel(button, idleLabel);
  }

  if (thrownError) throw thrownError;
  return result;
}
