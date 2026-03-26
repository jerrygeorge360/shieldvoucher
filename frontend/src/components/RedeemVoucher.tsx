import { useState } from 'react'
import { useWallet } from '../starknet-provider'
import {
  redeemVoucherWithProof,
  TOKENS,
  fetchVoucherEvents,
  getNextIndex,
  getCurrentRoot,
  TOKEN_DECIMALS,
  getShieldVoucherContractAddress
} from '../hooks/useShieldVoucher'
import { ShieldMerkleTree } from '../utils/merkle'
import { hash, cairo } from 'starknet'
import { submitProofJob, waitForJob, AtlanticJobStatus } from '../api/atlantic'
import { CIRCUIT_SIERRA_BASE64 } from '../api/circuit_data'

type Props = {
  connectedAddress: string | null
}

export function RedeemVoucher({ connectedAddress }: Props) {
  const { account } = useWallet()
  const [voucherInput, setVoucherInput] = useState('')
  const [recipientOverride, setRecipientOverride] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  function toSmallestUnits(value: string, decimals: number): bigint {
    const normalized = value.trim()
    const [wholePart, fracPart = ''] = normalized.split('.')
    const paddedFrac = fracPart.padEnd(decimals, '0')
    return BigInt(`${wholePart}${paddedFrac}`)
  }

  async function handleRedeem() {
    if (!connectedAddress || !account) {
      alert('Connect your wallet first')
      return
    }

    if (!voucherInput) {
      alert('Please enter a voucher code')
      return
    }

    setLoading(true)
    try {
      let currentPayload = voucherInput.trim()


      if (!currentPayload.startsWith('zk:')) {
        throw new Error('Unsupported voucher scheme. Only standard ZK vouchers are supported in this version.')
      }

      setStatusMessage('PARSING_VOUCHER_METADATA...')
      // format: zk:secret:nullifier:leaf_index:token:amount
      const parts = currentPayload.split(':')
      if (parts.length < 6) throw new Error('Invalid ZK voucher format.')

      const [_, secretHex, nullifierHex, leafIndexStr, tokenTicker, amountStr] = parts
      const secret = BigInt('0x' + secretHex)
      const nullifier = BigInt(nullifierHex)
      const leafIndex = parseInt(leafIndexStr)
      const amount = toSmallestUnits(amountStr, TOKEN_DECIMALS[tokenTicker as keyof typeof TOKEN_DECIMALS])
      const tokenAddr = TOKENS[tokenTicker as keyof typeof TOKENS]

      setStatusMessage('RECONSTRUCTING_MERKLE_TREE...')
      const VOUCHER_CREATED_SELECTOR = hash.getSelectorFromName('VoucherCreated')

      const fetchSmartTreeLeaves = async (reconstructCommitment: string, targetIdx: number) => {
        const onChainNextIdx = await getNextIndex()
        const rpcEvents = await fetchVoucherEvents()
        const VOUCHER_CREATED_SELECTOR = hash.getSelectorFromName('VoucherCreated')

        console.debug('TREE_DIAG: Total RPC events:', rpcEvents.length)
        console.debug('TREE_DIAG: On-chain nextIndex:', onChainNextIdx)
        console.debug('TREE_DIAG: VoucherCreated selector:', VOUCHER_CREATED_SELECTOR)

        // Log all event selectors for debugging
        const selectorCounts: Record<string, number> = {}
        rpcEvents.forEach(ev => {
          const sel = ev.keys?.[0] || 'no_keys'
          selectorCounts[sel] = (selectorCounts[sel] || 0) + 1
        })
        console.debug('TREE_DIAG: Event selector counts:', selectorCounts)

        // 1. Initialize with cryptographic zero-hashes (0x0 is the leaf level zero-hash in Cairo)
        const totalSize = Math.max(onChainNextIdx, targetIdx + 1)
        const combined = new Array(totalSize).fill("0x0")

        // 2. Map RPC leaves by index (assuming order of events = order of index)
        const rpcLeaves = rpcEvents
          .filter(ev => ev.keys && ev.keys[0] === VOUCHER_CREATED_SELECTOR)
          .map(ev => ev.data[0])

        console.debug('TREE_DIAG: VoucherCreated events found:', rpcLeaves.length, 'expected:', onChainNextIdx)
        rpcLeaves.forEach((leaf, i) => {
          console.debug(`TREE_DIAG: Event leaf[${i}] =`, leaf)
        })

        rpcLeaves.forEach((leaf, i) => {
          if (i < combined.length) combined[i] = leaf
        })

        // 3. SECURE_INJECTION: Ensure the voucher's own commitment is present at targetIdx
        if (targetIdx < combined.length) {
          const existingAtTarget = combined[targetIdx]
          console.debug(`TREE_DIAG: Leaf at targetIdx[${targetIdx}] before injection:`, existingAtTarget)
          console.debug(`TREE_DIAG: Injecting reconstructed commitment:`, reconstructCommitment)
          if (existingAtTarget !== '0x0' && existingAtTarget !== reconstructCommitment) {
            console.warn(`TREE_DIAG: WARNING — overwriting existing non-zero leaf at index ${targetIdx}!`)
          }
          combined[targetIdx] = reconstructCommitment
        }

        console.debug(`CRYPTO_DIAG: Smart Tree Reconstructed. Size: ${combined.length}, Target Index: ${targetIdx}`)
        console.debug('TREE_DIAG: Final leaves:', combined)
        return combined
      }

      // Reconstruct what the commitment SHOULD be from the voucher itself
      // commitment = pedersen(secret, nullifier)
      const reconstructedCommitment = hash.computePedersenHash(
        '0x' + BigInt(secret).toString(16),
        '0x' + BigInt(nullifier).toString(16)
      )
      console.debug('CRYPTO_DIAG: Reconstructed commitment from voucher:', reconstructedCommitment)

      let leaves = await fetchSmartTreeLeaves(reconstructedCommitment, leafIndex)

      const tree = new ShieldMerkleTree()
      leaves.forEach(leaf => tree.insert(leaf))

      setStatusMessage('RUNNING_PRE_FLIGHT_CHECKS...')

      // Pre-flight 1: Verify nullifier = pedersen(secret, leaf_index)
      const expectedNullifier = hash.computePedersenHash(
        '0x' + secret.toString(16),
        '0x' + BigInt(leafIndex).toString(16)
      )
      if (BigInt(expectedNullifier) !== nullifier) {
        throw new Error(`PRE_FLIGHT_FAIL: Nullifier mismatch. Expected ${expectedNullifier}, voucher has 0x${nullifier.toString(16)}`)
      }
      console.debug('PRE_FLIGHT: Nullifier OK')

      // Pre-flight 2: Verify Merkle proof locally
      const { proof } = tree.getProof(leafIndex)
      const localProofValid = ShieldMerkleTree.verifyProof(reconstructedCommitment, leafIndex, proof, tree.root)
      if (!localProofValid) {
        throw new Error('PRE_FLIGHT_FAIL: Local Merkle proof verification failed. Tree reconstruction error.')
      }
      console.debug('PRE_FLIGHT: Local Merkle proof OK')

      // Pre-flight 3: Compare reconstructed root vs on-chain root
      const onChainRootRaw = await getCurrentRoot()
      const onChainRoot = '0x' + BigInt(onChainRootRaw).toString(16)
      const offChainRoot = '0x' + BigInt(tree.root).toString(16)
      console.debug('PRE_FLIGHT: On-chain root:', onChainRoot, 'Off-chain root:', offChainRoot)
      if (onChainRoot !== offChainRoot) {
        throw new Error(`PRE_FLIGHT_FAIL: Root mismatch!\nOn-chain:  ${onChainRoot}\nOff-chain: ${offChainRoot}\nThe Merkle tree reconstruction does not match the contract state. Events may be incomplete.`)
      }
      console.debug('PRE_FLIGHT: Root match confirmed')

      setStatusMessage('PREPARING_ZK_PROVING_JOB...')
      const amountU256 = cairo.uint256(amount)

      // Flat argument array for Cairo 1 main function — ALL values must be hex with 0x prefix
      const args = [
        '0x' + secret.toString(16),
        '0x' + proof.length.toString(16),
        ...proof,
        '0x' + leafIndex.toString(16),
        '0x' + nullifier.toString(16),
        tree.root,
        tokenAddr,
        '0x' + amountU256.low.toString(16),
        '0x' + amountU256.high.toString(16),
        recipientOverride || connectedAddress
      ]

      setStatusMessage('SUBMITTING_TO_ATLANTIC_PROVER...')
      const { jobId } = await submitProofJob({ programSierra: CIRCUIT_SIERRA_BASE64, args })

      setStatusMessage(`PROVING_IN_PROGRESS (Job: ${jobId.slice(0, 8)})...`)
      await waitForJob(jobId, (status: AtlanticJobStatus) => {
        setStatusMessage(`ATLANTIC_STATUS: ${status}...`)
      })

      const recipient = recipientOverride || connectedAddress

      setStatusMessage('EXECUTING_FACT_BASED_REDEMPTION...')
      const redeemTxHash = await redeemVoucherWithProof(
        account,
        '0x' + nullifier.toString(16),
        tree.root,
        tokenAddr,
        amount,
        recipient
      )
      setTxHash(redeemTxHash)
      alert('Anonymous redemption successful!')
      setVoucherInput('')
    } catch (error: any) {
      console.error('Redeem error:', error)
      alert(`FAILED: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
      setStatusMessage('')
    }
  }

  return (
    <div style={{ maxWidth: '800px' }} className="reveal-stagger">
      <div className="grid-asymmetric">
        <div style={{ gridColumn: '1 / span 12' }} className="input-container animate-fade-in-up">
          <span className="input-label">VOUCHER_PAYLOAD</span>
          <input
            type="text"
            placeholder="zk:XXX..."
            value={voucherInput}
            onChange={(e) => setVoucherInput(e.target.value)}
            style={{ color: 'var(--accent)', fontSize: '1.25rem' }}
          />
        </div>


        <div style={{ gridColumn: '1 / span 12' }} className="input-container animate-fade-in-up">
          <span className="input-label">BENEFICIARY_ADDRESS_OVERRIDE (OPTIONAL)</span>
          <input
            type="text"
            placeholder={connectedAddress || "0x000..."}
            value={recipientOverride}
            onChange={(e) => setRecipientOverride(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 animate-fade-in-up">
        <button className="btn btn-accent mono" onClick={handleRedeem} disabled={loading} style={{ width: '100%', padding: '2rem' }}>
          {loading ? (statusMessage || 'PROCESSING...') : 'INITIATE_REDEMPTION_SEQUENCE'}
        </button>
      </div>

      {txHash && (
        <div className="mt-4 animate-fade-in-up" style={{ padding: '2rem', border: '1px solid var(--border)' }}>
          <div className="mono" style={{ fontSize: '0.75rem', color: '#27AE60', marginBottom: '1rem' }}>
            TRANSACTION_VERIFIED // ANONYMOUS_RELEASE_COMPLETE
          </div>
          <a href={`https://sepolia.voyager.online/tx/${txHash}`} target="_blank" rel="noreferrer" className="mono underline text-xs">
            VIEW_PROOFS_ON_BLOCK_EXPLORER_↗
          </a>
        </div>
      )}
    </div>
  )
}
