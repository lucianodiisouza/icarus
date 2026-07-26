import type { FileStore } from '../persistence/file-store.js';

/**
 * Secure storage for the user's BYOK provider key (E-13, T-13.3; ADR-0011). The key is a
 * secret that must **never** be written in plaintext and **never** transmitted — so this
 * store encrypts it through an injected OS-keychain-backed `Encryptor` before persisting the
 * ciphertext via a `FileStore`. Whether AI is available at all hinges on this: no key → the
 * assistant stays inert and the rest of Icarus is unaffected (AI is optional). Electron-free
 * (ADR-0002): the encryptor is the desktop's `safeStorage` adapter, injected here.
 */
export interface KeyStore {
  /** The stored key, or `null` if none is set (or the ciphertext can't be decrypted here). */
  get(): Promise<string | null>;
  /** Encrypt and persist the key. Throws if secure storage is unavailable on this OS. */
  set(key: string): Promise<void>;
  /** Remove the stored key. */
  clear(): Promise<void>;
}

/**
 * Encrypts/decrypts a secret to/from an opaque base64 token, backed by the OS keychain. The
 * desktop implements this with Electron `safeStorage`; tests inject a fake.
 */
export interface Encryptor {
  /** True when the OS keychain is usable (e.g. `safeStorage.isEncryptionAvailable()`). */
  isAvailable(): boolean;
  /** Encrypt plaintext → base64 ciphertext. */
  encrypt(plain: string): string;
  /** Decrypt base64 ciphertext → plaintext; throws if the ciphertext isn't ours. */
  decrypt(cipherBase64: string): string;
}

interface StoredKey {
  readonly v: 1;
  readonly cipher: string;
}

/** `KeyStore` that keeps only OS-encrypted ciphertext on disk — never the plaintext key. */
export class EncryptedKeyStore implements KeyStore {
  constructor(
    private readonly encryptor: Encryptor,
    private readonly store: FileStore,
  ) {}

  async get(): Promise<string | null> {
    const raw = await this.store.read();
    if (raw === null) return null;
    const record = parse(raw);
    if (record === null) return null;
    try {
      return this.encryptor.decrypt(record.cipher);
    } catch {
      // Ciphertext from another machine/keychain, or corrupt — treat as "no key", not a crash.
      return null;
    }
  }

  async set(key: string): Promise<void> {
    if (!this.encryptor.isAvailable()) {
      throw new Error(
        'Secure key storage is unavailable on this system; cannot store the API key.',
      );
    }
    const record: StoredKey = { v: 1, cipher: this.encryptor.encrypt(key) };
    await this.store.write(JSON.stringify(record));
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

function parse(raw: string): StoredKey | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record['v'] === 1 && typeof record['cipher'] === 'string') {
      return { v: 1, cipher: record['cipher'] };
    }
    return null;
  } catch {
    return null;
  }
}
