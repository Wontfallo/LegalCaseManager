"""
AES-256 encryption utilities for file-at-rest security.
Simulates AES-256-GCM encryption parameters for stored files.
"""

from __future__ import annotations

import hashlib
import os

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("encryption")


def _derive_key(passphrase: str) -> bytes:
    """Derive a 32-byte AES-256 key from the configured passphrase."""
    return hashlib.sha256(passphrase.encode("utf-8")).digest()


def encrypt_bytes(plaintext: bytes) -> bytes:
    """
    Encrypt bytes using AES-256-GCM.
    Format: [12-byte nonce][16-byte tag][ciphertext]
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        key = _derive_key(settings.file_encryption_key)
        nonce = os.urandom(12)  # 96-bit nonce for GCM
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)
        # ciphertext includes the 16-byte tag appended by the library
        return nonce + ciphertext
    except Exception as exc:
        logger.error("encryption_failed", error=str(exc))
        raise


def decrypt_bytes(encrypted: bytes) -> bytes:
    """
    Decrypt AES-256-GCM encrypted bytes.
    Expects format: [12-byte nonce][ciphertext+tag]
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        key = _derive_key(settings.file_encryption_key)
        nonce = encrypted[:12]
        ciphertext_with_tag = encrypted[12:]
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    except Exception as exc:
        logger.error("decryption_failed", error=str(exc))
        raise
