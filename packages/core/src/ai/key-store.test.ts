import { describe, expect, it, vi } from 'vitest';
import type { FileStore } from '../persistence/file-store.js';
import { EncryptedKeyStore, type Encryptor } from './key-store.js';

/** In-memory FileStore exposing its current contents. */
function memoryStore(initial: string | null = null): FileStore & { data: string | null } {
  const store = {
    data: initial,
    read: (): Promise<string | null> => Promise.resolve(store.data),
    write: (d: string): Promise<void> => {
      store.data = d;
      return Promise.resolve();
    },
    clear: (): Promise<void> => {
      store.data = null;
      return Promise.resolve();
    },
  };
  return store;
}

/** A fake encryptor: "encryption" is a reversible marker so tests can assert non-plaintext. */
function fakeEncryptor(available = true): Encryptor {
  return {
    isAvailable: () => available,
    encrypt: (plain) => `enc(${Buffer.from(plain).toString('base64')})`,
    decrypt: (cipher) => {
      const m = /^enc\((.*)\)$/.exec(cipher);
      if (!m) throw new Error('not our ciphertext');
      return Buffer.from(m[1]!, 'base64').toString('utf8');
    },
  };
}

describe('EncryptedKeyStore', () => {
  it('round-trips a key, storing only ciphertext (never plaintext)', async () => {
    const store = memoryStore();
    const keyStore = new EncryptedKeyStore(fakeEncryptor(), store);

    await keyStore.set('sk-secret-key-123');

    // The plaintext key must not appear on disk.
    expect(store.data).not.toContain('sk-secret-key-123');
    expect(JSON.parse(store.data!)).toMatchObject({ v: 1 });
    expect(await keyStore.get()).toBe('sk-secret-key-123');
  });

  it('returns null when no key is stored', async () => {
    expect(await new EncryptedKeyStore(fakeEncryptor(), memoryStore(null)).get()).toBeNull();
  });

  it('clear() removes the stored key', async () => {
    const store = memoryStore();
    const keyStore = new EncryptedKeyStore(fakeEncryptor(), store);
    await keyStore.set('sk-x');
    await keyStore.clear();
    expect(store.data).toBeNull();
    expect(await keyStore.get()).toBeNull();
  });

  it('throws on set() when secure storage is unavailable, writing nothing', async () => {
    const store = memoryStore();
    const keyStore = new EncryptedKeyStore(fakeEncryptor(false), store);
    await expect(keyStore.set('sk-x')).rejects.toThrow(/unavailable/i);
    expect(store.data).toBeNull();
  });

  it('returns null (not throw) when the ciphertext cannot be decrypted here', async () => {
    // Ciphertext written by a different machine/keychain — decrypt throws → treated as no key.
    const store = memoryStore(JSON.stringify({ v: 1, cipher: 'from-another-machine' }));
    const keyStore = new EncryptedKeyStore(fakeEncryptor(), store);
    expect(await keyStore.get()).toBeNull();
  });

  it('tolerates a corrupt store file (→ null)', async () => {
    const keyStore = new EncryptedKeyStore(fakeEncryptor(), memoryStore('{not json'));
    expect(await keyStore.get()).toBeNull();
  });

  it('does not decrypt when reading an empty/absent store', async () => {
    const enc = fakeEncryptor();
    const decrypt = vi.spyOn(enc, 'decrypt');
    await new EncryptedKeyStore(enc, memoryStore(null)).get();
    expect(decrypt).not.toHaveBeenCalled();
  });
});
