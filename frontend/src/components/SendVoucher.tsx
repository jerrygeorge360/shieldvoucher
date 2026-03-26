import { useState } from 'react'
import { generateRandomFelt, generateMixerCommitment } from '../utils/hash'
import { useWallet } from '../starknet-provider'
import {
  approveToken,
  lockFunds,
  SupportedToken,
  TOKEN_DECIMALS,
  TOKENS,
  getShieldVoucherContractAddress,
  getNextIndex,
  mintMockWBTC,
} from '../hooks/useShieldVoucher'

type Props = {
  connectedAddress: string | null
}

const LOCK_OPTIONS = [
  ...(import.meta.env.VITE_IS_TESTNET === 'true' ? [{ label: 'INSTANT (TESTNET)', value: 0 }] : []),
  { label: '1 HOUR (MIN)', value: 3600 },
  { label: '24 HOURS', value: 86400 },
  { label: '7 DAYS', value: 604800 },
  { label: '30 DAYS (MAX)', value: 2592000 },
]

export function SendVoucher({ connectedAddress }: Props) {
  const { account } = useWallet()
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState<SupportedToken>('WBTC')
  const [lockDuration, setLockDuration] = useState(LOCK_OPTIONS[0].value)
  const [voucherCode, setVoucherCode] = useState<string | null>(null)
  const [isEncrypted, setIsEncrypted] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function toSmallestUnits(value: string, decimals: number): bigint {
    const normalized = value.trim()
    if (!normalized) throw new Error('Amount is required')
    const [wholePart, fracPart = ''] = normalized.split('.')
    const paddedFrac = fracPart.padEnd(decimals, '0')
    return BigInt(`${wholePart}${paddedFrac}`)
  }

  async function handleSend() {
    if (!connectedAddress || !account) {
      alert('Connect your wallet first')
      return
    }

    if (!amount || Number(amount) <= 0) {
      alert('Please fill a valid amount')
      return
    }

    setLoading(true)
    try {
      // 1. Fetch index BEFORE everything else
      const leafIndex = await getNextIndex()
      console.log('DEBUG: Fetched leafIndex:', leafIndex)

      // 2. Derive secrets and commitments
      const secret = generateRandomFelt()
      const nullifierHex = generateMixerCommitment(secret, BigInt(leafIndex))
      const commitment = generateMixerCommitment(secret, BigInt(nullifierHex))

      const rawCode = `zk:${secret.toString(16)}:${nullifierHex}:${leafIndex}:${token}:${amount}`
      console.log('DEBUG: Generated commitment:', commitment)

      // 3. Prepare token params
      const amountBigInt = toSmallestUnits(amount, TOKEN_DECIMALS[token])
      const tokenAddress = TOKENS[token]
      const voucherAddress = getShieldVoucherContractAddress()

      // 4. On-chain sequence (will timeout if RPC hangs)
      console.log('DEBUG: Approving token...')
      await approveToken(account, tokenAddress, voucherAddress, amountBigInt)

      console.log('DEBUG: Locking funds...')
      const lockTxHash = await lockFunds(account, commitment, tokenAddress, amountBigInt, lockDuration)
      setTxHash(lockTxHash)

      setVoucherCode(rawCode)
      setIsEncrypted(false)

      // 6. Resilience: Store commitment locally to bypass RPC indexing lag
      try {
        const cacheKey = `shield_leaves_${voucherAddress.toLowerCase()}`
        const localLeaves = JSON.parse(localStorage.getItem(cacheKey) || '[]')
        if (!localLeaves.includes(commitment)) {
          localLeaves.push(commitment)
          localStorage.setItem(cacheKey, JSON.stringify(localLeaves))
          console.debug('CRYPTO_DIAG: Commitment cached locally for instant sync.')
        }
      } catch (storageErr) {
        console.warn('Failed to cache commitment locally:', storageErr)
      }

      console.log('DEBUG: Voucher generated successfully.')

    } catch (error) {
      console.error('Critical Error in handleSend:', error)
      alert('Transaction Failed or Timed Out: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '800px' }} className="reveal-stagger">
      <div className="grid-asymmetric">

        <div style={{ gridColumn: '1 / span 8' }} className="animate-fade-in-up">
          <div className="input-container">
            <span className="input-label">VOUCH_AMOUNT</span>
            <input
              type="text"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div style={{ gridColumn: '9 / span 4' }} className="animate-fade-in-up">
          <div className="input-container">
            <span className="input-label">CURRENCY</span>
            <div className="option-group">
              <button className={`option-btn ${token === 'STRK' ? 'active' : ''}`} onClick={() => setToken('STRK')}>STRK</button>
              <button className={`option-btn ${token === 'WBTC' ? 'active' : ''}`} onClick={() => setToken('WBTC')}>WBTC</button>
            </div>
            {token === 'WBTC' && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', opacity: 0.6, textAlign: 'right' }} className="mono">
                Don't have WBTC? Bridge native BTC → WBTC via <a href="https://app.garden.finance" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Garden</a>
              </div>
            )}
          </div>
        </div>

        {token === 'WBTC' && (
          <div style={{ gridColumn: '1 / span 12' }} className="animate-fade-in-up mt-2">
            <button
              className="btn btn-secondary mono"
              style={{ width: '100%', padding: '1rem', borderStyle: 'dashed' }}
              onClick={async () => {
                if (!account || !connectedAddress) return alert('Connect wallet first');
                setLoading(true);
                try {
                  const tx = await mintMockWBTC(account, connectedAddress, 1000000n); // 0.01 WBTC
                  alert(`Success! 0.01 Test WBTC minted. Tx: ${tx}`);
                } catch (e: any) {
                  alert('Mint failed: ' + e.message);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              [ GET_TEST_WBTC_FAUCET_0.01 ]
            </button>
          </div>
        )}

        {/* Refund Time Lock (PH-8) */}
        <div style={{ gridColumn: '1 / span 12' }} className="animate-fade-in-up">
          <div className="input-container">
            <span className="input-label">REFUND_EMBARGO_PERIOD</span>
            <div className="option-group">
              {LOCK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`option-btn ${lockDuration === opt.value ? 'active' : ''}`}
                  onClick={() => setLockDuration(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 animate-fade-in-up">
        <button className="btn btn-accent mono" onClick={handleSend} disabled={loading} style={{ width: '100%', padding: '2rem' }}>
          {loading ? 'EXECUTING_HARDENED_DEPOSIT...' : 'GENERATE_PROTECTED_VOUCHER'}
        </button>
      </div>

      {voucherCode && (
        <div className="mt-4 animate-fade-in-up" style={{ padding: '4rem', background: isEncrypted ? '#E0F0E5' : '#F0EBE0', color: '#0D0D0D', position: 'relative', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
          <div className="mono" style={{ fontSize: '0.75rem', marginBottom: '2rem', borderBottom: '1px solid rgba(13,13,13,0.1)', paddingBottom: '1rem', opacity: 0.5 }}>
            {isEncrypted ? 'ENCRYPTED // FOR_RECIPIENT_ONLY' : 'CLASSIFIED // UNENCRYPTED_SECRET'}
          </div>
          <h3 className="hero-medium mb-2">VOUCHER_PAYLOAD</h3>
          <div className="mono" style={{ fontSize: isEncrypted ? '1rem' : '1.5rem', wordBreak: 'break-all', color: isEncrypted ? '#27AE60' : '#C0392B' }}>
            {voucherCode}
          </div>
          <div className="mt-4 mono" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
            <strong>UNLOCK_TIMESTAMP:</strong> {lockDuration === 0 ? 'AVAILABLE_IMMEDIATELY' : new Date(Date.now() + lockDuration * 1000).toLocaleString()}
            {lockDuration === 0 && <span style={{ color: '#C0392B', marginLeft: '0.5rem' }}>⚠ TESTING ONLY — NO PRIVACY GUARANTEE</span>}
          </div>
          <p className="mt-4" style={{ fontSize: '0.9rem', opacity: 0.7 }}>
            CAUTION: This code contains the plaintext secret. It will never be shown again. Ensure you save it securely.
          </p>
          {txHash && (
            <div className="mt-4">
              <a href={`https://sepolia.voyager.online/tx/${txHash}`} target="_blank" rel="noreferrer" className="mono underline text-xs">VERIFY_ON_EXPLORER_↗</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
