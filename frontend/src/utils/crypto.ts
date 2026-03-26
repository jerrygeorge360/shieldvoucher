import { ec } from 'starknet';

function bToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hToBytes(hex: string): Uint8Array {
    return new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

/**
 * Derives an AES key from a shared secret via hashing.
 * 
 * We strictly use THE X COORDINATE which is the first 32 bytes after the prefix (if 02/03/04).
 * Or if length is 32, it's already X.
 */
async function deriveAesKey(sharedSecret: Uint8Array, stage: 'ENC' | 'DEC'): Promise<CryptoKey> {
    let xCoordinate: Uint8Array;

    if (sharedSecret.length === 32) {
        xCoordinate = sharedSecret;
    } else if (sharedSecret.length === 33) {
        xCoordinate = sharedSecret.slice(1);
    } else if (sharedSecret.length === 65) {
        xCoordinate = sharedSecret.slice(1, 33);
    } else {
        throw new Error(`Unexpected shared secret length: ${sharedSecret.length}`);
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', xCoordinate as any);

    // Debug fingerprint (first 4 bytes of hash) to detect mismatches without leaking full key
    const fingerprint = bToHex(new Uint8Array(hashBuffer).slice(0, 4));
    console.debug(`CRYPTO_DIAG [${stage}]: Key Fingerprint [${fingerprint}] derived from secret len ${sharedSecret.length}`);

    return crypto.subtle.importKey(
        'raw',
        hashBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts a payload for a recipient's Starknet public key using ECIES-like flow.
 */
export async function encryptVoucher(payload: string, recipientPubKey: string): Promise<string> {
    const ephemeralPriv = ec.starkCurve.utils.randomPrivateKey();
    const ephemeralPub = ec.starkCurve.getPublicKey(ephemeralPriv); // returns Uint8Array (33 or 65 bytes)

    // Normalize recipient public key to Uint8Array (compressed)
    const rawX = recipientPubKey.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const compressedRecipientPubHex = rawX.length === 64 ? '02' + rawX : rawX;
    const recipientPubBytes = hToBytes(compressedRecipientPubHex);

    // Stark ECDH
    const sharedSecret = ec.starkCurve.getSharedSecret(
        ephemeralPriv,
        recipientPubBytes
    );
    const key = await deriveAesKey(sharedSecret, 'ENC');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as any },
        key,
        new TextEncoder().encode(payload)
    );

    const ciphertextHex = bToHex(new Uint8Array(encrypted));
    const ivHex = bToHex(iv);
    // Ensure ephemeralPub is hex string
    const ephemeralPubHex = bToHex(Uint8Array.from(ephemeralPub));

    return `v2:${ephemeralPubHex}:${ivHex}:${ciphertextHex}`;
}

/**
 * Decrypts a voucher bundle using the recipient's private key.
 */
export async function decryptVoucher(bundle: string, privateKey: string): Promise<string> {
    if (!bundle.startsWith('v2:')) throw new Error('Invalid encrypted voucher format');

    const [, ephemeralPubHex, ivHex, ciphertextHex] = bundle.split(':');

    const ephemPubBytes = hToBytes(ephemeralPubHex.replace(/^0x/, ''));
    const privKeyBytes = hToBytes(privateKey.replace(/^0x/, '').toLowerCase().padStart(64, '0'));

    // Stark ECDH
    const sharedSecret = ec.starkCurve.getSharedSecret(
        privKeyBytes,
        ephemPubBytes
    );
    const key = await deriveAesKey(sharedSecret, 'DEC');

    const iv = hToBytes(ivHex);
    const ciphertext = hToBytes(ciphertextHex);

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as any },
            key,
            ciphertext as any
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('DECRYPTION_FAILURE: Auth tag mismatch. This means the fingerprint above must match the ENCRYPTION fingerprint.');
        throw e;
    }
}
