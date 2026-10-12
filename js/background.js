/**
 * Persistent room-side listener for live image shares.
 * The action popover can be closed without disabling image delivery.
 */

import OBR from 'https://esm.sh/@owlbear-rodeo/sdk@3.1.0';
import {
  IMAGE_SHARE_STATUS,
  listenForImageShares,
  sendImageShareStatus
} from './services/ImageShareService.js';

let stopListening = null;
let activeShare = null;
let modalQueue = Promise.resolve();
const MODAL_OPERATION_TIMEOUT_MS = 5000;

function withModalTimeout(promise, operation) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation}_timeout`));
    }, MODAL_OPERATION_TIMEOUT_MS);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function buildViewerUrl({ url, caption, shareId, senderConnectionId }) {
  const viewerUrl = new URL('../html/image-viewer.html', window.location.href);
  viewerUrl.searchParams.set('url', encodeURIComponent(url));
  if (caption) viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
  viewerUrl.searchParams.set('share', 'false');
  if (shareId) viewerUrl.searchParams.set('shareId', shareId);
  if (senderConnectionId) {
    viewerUrl.searchParams.set('senderConnectionId', senderConnectionId);
  }
  return viewerUrl.toString();
}

OBR.onReady(() => {
  stopListening = listenForImageShares({
    OBR,
    // A shared image is a live presentation: the newest share replaces the
    // previous one instead of stacking multiple full-screen modals.
    openImage: (nextShare) => {
      modalQueue = modalQueue.catch(() => {}).then(async () => {
        if (
          activeShare?.shareId &&
          activeShare.shareId !== nextShare.shareId &&
          activeShare.senderConnectionId
        ) {
          void sendImageShareStatus(OBR, {
            shareId: activeShare.shareId,
            targetConnectionId: activeShare.senderConnectionId,
            status: IMAGE_SHARE_STATUS.FAILED,
            reason: 'replaced_by_new_share'
          }).catch(() => {});
        }

        try {
          await withModalTimeout(
            OBR.modal.close('notion-image-viewer'),
            'modal_close'
          );
        } catch (_error) {
          // No image modal was open yet.
        }
        activeShare = null;

        await withModalTimeout(
          OBR.modal.open({
            id: 'notion-image-viewer',
            url: buildViewerUrl(nextShare),
            fullScreen: true,
            hidePaper: true
          }),
          'modal_open'
        );
        activeShare = nextShare;
      });
      return modalQueue;
    }
  });
});

window.addEventListener('beforeunload', () => {
  stopListening?.();
  stopListening = null;
});
