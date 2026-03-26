import { hash } from 'starknet'

/**
 * Standard Mode: commitment = pedersen(secret, recipientAddress)
 */
export function generateStandardCommitment(
  secret: bigint,
  recipientAddress: string
): string {
  return hash.computePedersenHash(
    '0x' + secret.toString(16),
    recipientAddress
  )
}

/**
 * ZK Mode: commitment = pedersen(secret, nullifier)
 * This decouples the deposit from the recipient.
 */
export function generateMixerCommitment(
  secret: bigint,
  nullifier: bigint
): string {
  return hash.computePedersenHash(
    '0x' + secret.toString(16),
    '0x' + nullifier.toString(16)
  )
}

/**
 * Generate a cryptographically random secret or nullifier
 */
export function generateRandomFelt(): bigint {
  const array = new Uint8Array(31)
  crypto.getRandomValues(array)
  return BigInt('0x' + Array.from(array).map(b =>
    b.toString(16).padStart(2, '0')).join('')
  )
}

// Deprecated alias
export const generateSecret = generateRandomFelt
export const generateNullifier = generateRandomFelt
