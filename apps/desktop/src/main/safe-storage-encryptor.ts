import { safeStorage } from 'electron';
import type { Encryptor } from '@icarus/core';

/**
 * The Electron `safeStorage` implementation of `@icarus/core`'s `Encryptor` (E-13, T-13.3).
 * `safeStorage` binds encryption to the OS keychain (Keychain on macOS, libsecret on Linux,
 * DPAPI on Windows), so the BYOK key's ciphertext is only decryptable on this machine and
 * by this user — never plaintext on disk, never portable. Ciphertext is stored base64.
 */
export const safeStorageEncryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (cipherBase64) => safeStorage.decryptString(Buffer.from(cipherBase64, 'base64')),
};
