/**
 * Reliable, live-only image sharing for players currently connected to a room.
 *
 * The protocol deliberately keeps no persistent state. Owlbear broadcasts are
 * ephemeral, so a GM must stay connected and only the current party is tracked.
 */

import { BROADCAST_CHANNEL_SHOW_IMAGE } from '../utils/constants.js';

export const IMAGE_SHARE_CHANNEL = BROADCAST_CHANNEL_SHOW_IMAGE;
export const IMAGE_SHARE_STATUS_CHANNEL = 'com.dmscreen/imageShareStatus';
export const IMAGE_SHARE_PROTOCOL_VERSION = 1;

export const IMAGE_SHARE_STATUS = Object.freeze({
  RECEIVED: 'received',
  LOADED: 'loaded',
  FAILED: 'failed'
});

const VALID_STATUSES = new Set(Object.values(IMAGE_SHARE_STATUS));
const TERMINAL_STATUSES = new Set([
  IMAGE_SHARE_STATUS.LOADED,
  IMAGE_SHARE_STATUS.FAILED
]);

function createShareId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isDisplayableRemoteUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    // HTTPS Owlbear rooms cannot display mixed-content HTTP images anyway.
    if (parsed.protocol === 'http:' && globalThis.location?.protocol === 'https:') {
      return false;
    }

    const isPrivateHost = (hostname) => {
      const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
        return true;
      }
      const isIpv6 = host.includes(':');
      if (
        isIpv6 &&
        (/^f[cd]/.test(host) || /^fe[89ab]/.test(host))
      ) {
        return true;
      }

      const octets = host.split('.').map(Number);
      if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
        return false;
      }
      return octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168);
    };

    if (isPrivateHost(parsed.hostname)) {
      // Keep localhost development usable, but never let a production build
      // probe a player's loopback or private network through image loading.
      return isPrivateHost(globalThis.location?.hostname || '');
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function asUnsubscribe(subscription) {
  if (typeof subscription === 'function') return subscription;
  if (typeof subscription?.unsubscribe === 'function') {
    return () => subscription.unsubscribe();
  }
  return () => {};
}

function reportProgress(callback, progress) {
  try {
    callback?.(progress);
  } catch (error) {
    console.warn('Image share progress callback failed:', error);
  }
}

function withTimeout(promise, timeoutMs, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, Math.max(1, timeoutMs));

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

function getProgress(phase, shareId, recipients, delivery) {
  let loaded = 0;
  let failed = 0;
  let loading = 0;

  for (const status of delivery.values()) {
    if (status === IMAGE_SHARE_STATUS.LOADED) loaded += 1;
    else if (status === IMAGE_SHARE_STATUS.FAILED) failed += 1;
    else if (status === IMAGE_SHARE_STATUS.RECEIVED) loading += 1;
  }

  const total = recipients.size;
  const acknowledged = delivery.size;

  return {
    phase,
    shareId,
    total,
    acknowledged,
    loaded,
    failed,
    loading,
    missing: Math.max(0, total - acknowledged),
    pending: Math.max(0, total - loaded - failed)
  };
}

/**
 * Share an image and wait for per-connection delivery/load acknowledgements.
 * A retry rebroadcasts to the room because Owlbear broadcasts cannot target a
 * single connection. Receivers deduplicate the stable shareId.
 */
export async function shareImageWithPlayers({
  OBR,
  url,
  caption = '',
  onProgress,
  retryDelayMs = 1800,
  timeoutMs = 25000,
  shareId = createShareId()
}) {
  if (!OBR?.broadcast?.sendMessage || !OBR?.broadcast?.onMessage) {
    const result = { phase: 'error', shareId, error: 'broadcast_unavailable' };
    reportProgress(onProgress, result);
    return result;
  }

  if (!url || !isDisplayableRemoteUrl(url)) {
    const result = { phase: 'error', shareId, error: 'invalid_url' };
    reportProgress(onProgress, result);
    return result;
  }

  let senderConnectionId;
  let party;
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 25000;

  try {
    [senderConnectionId, party] = await withTimeout(
      Promise.all([
        OBR.player.getConnectionId(),
        OBR.party.getPlayers()
      ]),
      Math.min(safeTimeoutMs, 5000),
      'party_timeout'
    );
  } catch (error) {
    const result = {
      phase: 'error',
      shareId,
      error: error?.code === 'party_timeout'
        ? 'party_timeout'
        : 'party_unavailable',
      cause: error
    };
    reportProgress(onProgress, result);
    return result;
  }

  const recipients = new Set(
    (Array.isArray(party) ? party : [])
      .map((player) => player?.connectionId)
      .filter(Boolean)
  );
  const delivery = new Map();

  if (recipients.size === 0) {
    const result = getProgress('no_recipients', shareId, recipients, delivery);
    reportProgress(onProgress, result);
    return result;
  }

  const payload = {
    version: IMAGE_SHARE_PROTOCOL_VERSION,
    shareId,
    url,
    caption,
    sentAt: Date.now()
  };

  reportProgress(onProgress, getProgress('sending', shareId, recipients, delivery));

  return new Promise((resolve) => {
    let finished = false;
    let retryTimer = null;
    let timeoutTimer = null;

    const finish = (phase = 'complete', extra = {}) => {
      if (finished) return;
      finished = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe();

      const result = {
        ...getProgress(phase, shareId, recipients, delivery),
        ...extra
      };
      reportProgress(onProgress, result);
      resolve(result);
    };

    const handleStatus = (event) => {
      const data = event?.data;
      if (
        !data ||
        data.version !== IMAGE_SHARE_PROTOCOL_VERSION ||
        data.shareId !== shareId ||
        data.targetConnectionId !== senderConnectionId ||
        !recipients.has(event.connectionId) ||
        !VALID_STATUSES.has(data.status)
      ) {
        return;
      }

      const current = delivery.get(event.connectionId);
      if (TERMINAL_STATUSES.has(current)) return;
      if (current === IMAGE_SHARE_STATUS.RECEIVED && data.status === IMAGE_SHARE_STATUS.RECEIVED) {
        return;
      }

      delivery.set(event.connectionId, data.status);
      reportProgress(onProgress, getProgress('progress', shareId, recipients, delivery));

      const allTerminal = [...recipients].every((connectionId) =>
        TERMINAL_STATUSES.has(delivery.get(connectionId))
      );
      if (allTerminal) finish();
    };

    const subscription = OBR.broadcast.onMessage(
      IMAGE_SHARE_STATUS_CHANNEL,
      handleStatus
    );
    const unsubscribe = asUnsubscribe(subscription);

    const send = async () => {
      await OBR.broadcast.sendMessage(
        IMAGE_SHARE_CHANNEL,
        payload,
        { destination: 'REMOTE' }
      );
    };

    // Arm the watchdog before invoking the SDK. A stalled initial send must
    // not keep the share button or acknowledgement listener alive forever.
    timeoutTimer = setTimeout(() => finish(), safeTimeoutMs);

    send().then(() => {
      if (finished) return;
      reportProgress(onProgress, getProgress('sent', shareId, recipients, delivery));

      retryTimer = setTimeout(async () => {
        if (finished) return;
        const hasPendingDelivery = [...recipients].some(
          (connectionId) => !TERMINAL_STATUSES.has(delivery.get(connectionId))
        );
        if (!hasPendingDelivery) return;

        reportProgress(onProgress, getProgress('retrying', shareId, recipients, delivery));
        try {
          await send();
        } catch (error) {
          console.warn('Could not retry image share:', error);
        }
      }, retryDelayMs);

    }).catch((error) => {
      finish('error', {
        error: error?.message || 'send_failed',
        cause: error
      });
    });
  });
}

/** Send a status acknowledgement back to the connection that shared an image. */
export async function sendImageShareStatus(OBR, {
  shareId,
  targetConnectionId,
  status,
  reason
}) {
  if (!shareId || !targetConnectionId || !VALID_STATUSES.has(status)) return false;

  await OBR.broadcast.sendMessage(
    IMAGE_SHARE_STATUS_CHANNEL,
    {
      version: IMAGE_SHARE_PROTOCOL_VERSION,
      shareId,
      targetConnectionId,
      status,
      ...(reason ? { reason: String(reason).slice(0, 160) } : {})
    },
    // ALL also lets the receiver background remember the terminal viewer
    // status and replay it if the GM's first acknowledgement is lost.
    { destination: 'ALL' }
  );
  return true;
}

/**
 * Install the single background receiver for image sharing.
 * `openImage` receives trusted sender metadata derived from BroadcastEvent.
 */
export function listenForImageShares({
  OBR,
  openImage,
  dedupeTtlMs = 60000,
  now = () => Date.now()
}) {
  const seen = new Map();
  const localConnectionIdPromise = OBR.player.getConnectionId().catch(() => null);

  const acknowledge = async (payload) => {
    try {
      await sendImageShareStatus(OBR, payload);
    } catch (error) {
      // Delivery feedback must never prevent the player from seeing the image.
      console.warn('Could not acknowledge image share:', error);
    }
  };

  const pruneSeen = () => {
    const cutoff = now() - dedupeTtlMs;
    for (const [key, entry] of seen) {
      if (entry.timestamp < cutoff) seen.delete(key);
    }
  };

  const statusSubscription = OBR.broadcast.onMessage(
    IMAGE_SHARE_STATUS_CHANNEL,
    async (event) => {
      const localConnectionId = await localConnectionIdPromise;
      const data = event?.data;
      if (
        !localConnectionId ||
        event?.connectionId !== localConnectionId ||
        data?.version !== IMAGE_SHARE_PROTOCOL_VERSION ||
        !data.shareId ||
        !data.targetConnectionId ||
        !VALID_STATUSES.has(data.status)
      ) {
        return;
      }

      const key = `${data.targetConnectionId}:${data.shareId}`;
      const entry = seen.get(key);
      if (entry) {
        if (TERMINAL_STATUSES.has(entry.status)) return;
        entry.status = data.status;
        entry.timestamp = now();
      }
    }
  );

  const subscription = OBR.broadcast.onMessage(
    IMAGE_SHARE_CHANNEL,
    async (event) => {
      const data = event?.data;
      if (!data?.url || !event?.connectionId || !isDisplayableRemoteUrl(data.url)) {
        return;
      }

      let party;
      try {
        party = await OBR.party.getPlayers();
      } catch (error) {
        console.warn('Could not validate image share sender:', error);
        return;
      }

      const sender = (Array.isArray(party) ? party : []).find(
        (player) => player?.connectionId === event.connectionId
      );
      if (!sender || sender.role !== 'GM') return;

      const isReliableMessage =
        data.version === IMAGE_SHARE_PROTOCOL_VERSION && Boolean(data.shareId);
      const dedupeKey = isReliableMessage
        ? `${event.connectionId}:${data.shareId}`
        : '';

      pruneSeen();
      if (dedupeKey && seen.has(dedupeKey)) {
        const previousStatus = seen.get(dedupeKey).status;
        if (isReliableMessage) {
          void acknowledge({
            shareId: data.shareId,
            targetConnectionId: event.connectionId,
            status: previousStatus || IMAGE_SHARE_STATUS.RECEIVED
          });
        }
        return;
      }
      if (dedupeKey) {
        seen.set(dedupeKey, {
          timestamp: now(),
          status: IMAGE_SHARE_STATUS.RECEIVED
        });
      }

      if (isReliableMessage) {
        void acknowledge({
          shareId: data.shareId,
          targetConnectionId: event.connectionId,
          status: IMAGE_SHARE_STATUS.RECEIVED
        });
      }

      try {
        await openImage({
          url: data.url,
          caption: data.caption || '',
          shareId: isReliableMessage ? data.shareId : '',
          senderConnectionId: isReliableMessage ? event.connectionId : ''
        });
      } catch (error) {
        console.warn('Could not open a shared image:', error);
        if (isReliableMessage) {
          const entry = seen.get(dedupeKey);
          if (entry) entry.status = IMAGE_SHARE_STATUS.FAILED;
          void acknowledge({
            shareId: data.shareId,
            targetConnectionId: event.connectionId,
            status: IMAGE_SHARE_STATUS.FAILED,
            reason: 'modal_open_failed'
          });
        }
      }
    }
  );

  const unsubscribeImage = asUnsubscribe(subscription);
  const unsubscribeStatus = asUnsubscribe(statusSubscription);
  return () => {
    unsubscribeImage();
    unsubscribeStatus();
  };
}
