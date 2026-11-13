/**
 * End-to-end encryption helpers for full-vault Co-GM transfers.
 *
 * Owlbear broadcasts are room-wide and cannot target one connection. An
 * ephemeral ECDH key agreement keeps the vault readable only by the GM that
 * requested it; AES-GCM also rejects modified ciphertext.
 */

export const SECURE_VAULT_PROTOCOL = 'ecdh-p256-aes-gcm-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getCrypto() {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) {
    throw new Error('Secure vault transfer is unavailable in this browser');
  }
  return cryptoImpl;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importPeerPublicKey(publicKey) {
  if (
    !publicKey ||
    publicKey.kty !== 'EC' ||
    publicKey.crv !== 'P-256' ||
    typeof publicKey.x !== 'string' ||
    typeof publicKey.y !== 'string'
  ) {
    throw new Error('Invalid secure vault public key');
  }

  return getCrypto().subtle.importKey(
    'jwk',
    publicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

async function deriveAesKey(privateKey, publicKey, usages) {
  const peerKey = await importPeerPublicKey(publicKey);
  return getCrypto().subtle.deriveKey(
    { name: 'ECDH', public: peerKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

export async function createVaultTransferRequest(requesterId, requesterName = '') {
  if (!requesterId) throw new Error('A requester id is required');
  const cryptoImpl = getCrypto();
  const keyPair = await cryptoImpl.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
  const publicKey = await cryptoImpl.subtle.exportKey('jwk', keyPair.publicKey);
  const requestId = cryptoImpl.randomUUID
    ? cryptoImpl.randomUUID()
    : `${Date.now().toString(36)}-${bytesToBase64(cryptoImpl.getRandomValues(new Uint8Array(16)))}`;

  return {
    privateKey: keyPair.privateKey,
    request: {
      protocol: SECURE_VAULT_PROTOCOL,
      requestId,
      requesterId,
      requesterName,
      publicKey
    }
  };
}

export async function encryptVaultForRequester(config, requesterPublicKey) {
  const cryptoImpl = getCrypto();
  const senderKeyPair = await cryptoImpl.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
  const aesKey = await deriveAesKey(senderKeyPair.privateKey, requesterPublicKey, ['encrypt']);
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(config));
  const ciphertext = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);

  return {
    protocol: SECURE_VAULT_PROTOCOL,
    senderPublicKey: await cryptoImpl.subtle.exportKey('jwk', senderKeyPair.publicKey),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptVaultFromGM(envelope, requesterPrivateKey) {
  if (
    envelope?.protocol !== SECURE_VAULT_PROTOCOL ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('Invalid secure vault envelope');
  }

  const aesKey = await deriveAesKey(
    requesterPrivateKey,
    envelope.senderPublicKey,
    ['decrypt']
  );
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    aesKey,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext));
}
