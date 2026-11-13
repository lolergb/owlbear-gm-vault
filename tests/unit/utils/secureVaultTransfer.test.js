import { describe, expect, it } from '@jest/globals';
import {
  SECURE_VAULT_PROTOCOL,
  createVaultTransferRequest,
  decryptVaultFromGM,
  encryptVaultForRequester
} from '../../../js/utils/secureVaultTransfer.js';

describe('secure vault transfer crypto', () => {
  it('round-trips a large Unicode vault without exposing plaintext', async () => {
    const config = {
      categories: [{
        name: 'GM secrets 🔐',
        pages: [{ name: 'Dragon', url: 'https://secret.example/dragon' }]
      }],
      notes: 'muy secreto 🐉 '.repeat(6000)
    };
    const { privateKey, request } = await createVaultTransferRequest('co-gm-1', 'Co-GM');
    const envelope = await encryptVaultForRequester(config, request.publicKey);

    expect(envelope.protocol).toBe(SECURE_VAULT_PROTOCOL);
    expect(envelope.ciphertext).not.toContain('Dragon');
    expect(envelope.ciphertext).not.toContain('secret.example');
    await expect(decryptVaultFromGM(envelope, privateKey)).resolves.toEqual(config);
  });

  it('rejects modified ciphertext', async () => {
    const { privateKey, request } = await createVaultTransferRequest('co-gm-1');
    const envelope = await encryptVaultForRequester({ categories: [] }, request.publicKey);
    const last = envelope.ciphertext.at(-1);
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`
    };

    await expect(decryptVaultFromGM(tampered, privateKey)).rejects.toThrow();
  });

  it('cannot be decrypted with another requester private key', async () => {
    const intended = await createVaultTransferRequest('co-gm-1');
    const attacker = await createVaultTransferRequest('co-gm-2');
    const envelope = await encryptVaultForRequester(
      { categories: [{ name: 'Hidden' }] },
      intended.request.publicKey
    );

    await expect(decryptVaultFromGM(envelope, attacker.privateKey)).rejects.toThrow();
  });
});
