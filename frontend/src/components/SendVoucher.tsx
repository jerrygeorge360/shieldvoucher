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
  const [copied, setCopied] = useState(false)

  async function copyToClipboard() {
    if (!voucherCode) return
    try {
      await navigator.clipboard.writeText(voucherCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy!', err)
    }
  }

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
                  const tx = await mintMockWBTC(account, connectedAddress, 500000000n); // 5 WBTC
                  alert(`Success! 5 Test WBTC minted. Tx: ${tx}`);
                } catch (e: any) {
                  alert('Mint failed: ' + e.message);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              [ GET_TEST_WBTC_FAUCET_5 ]
            </button>
          </div>
        )}

        {/* Refund Time Lock (PH-8) */}
        <div style={{ gridColumn: '1 / span 12' }} className="animate-fade-in-up">
          <div className="input-container">
            <span className="input-label">REFUND_EMBARGO_PERIOD // RECIPIENT_ACCESS_IS_ALWAYS_INSTANT</span>
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
        <div className="mt-8 animate-fade-in-up" style={{
          padding: '3rem',
          background: isEncrypted ? 'linear-gradient(135deg, #1A2E21 0%, #0D0D0D 100%)' : 'linear-gradient(135deg, #2E1A1A 0%, #0D0D0D 100%)',
          color: '#F0EBE0',
          position: 'relative',
          border: `1px solid ${isEncrypted ? '#27AE6044' : '#C0392B44'}`,
          borderRadius: '4px',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8)'
        }}>
          {/* Security Header */}
          <div className="flex justify-between items-center mb-8 pb-4" style={{ borderBottom: '1px solid rgba(240,235,224,0.1)' }}>
            <div className="mono" style={{ fontSize: '0.7rem', letterSpacing: '0.2em', opacity: 0.5 }}>
              {isEncrypted ? 'SYSTEM_STATUS // ENCRYPTED_PAYLOAD' : 'SYSTEM_STATUS // UNENCRYPTED_SECRET'}
            </div>
            <div className="mono" style={{ fontSize: '0.7rem', color: isEncrypted ? '#27AE60' : '#C0392B' }}>
              ● {isEncrypted ? 'SECURE_CHANNEL' : 'HIGH_RISK_WARNING'}
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <h3 className="hero-medium mb-4" style={{ fontSize: '1.5rem', letterSpacing: '0.05em' }}>VOUCHER_PAYLOAD</h3>
            
            <div className="mono" style={{
              background: 'rgba(0,0,0,0.3)',
              padding: '2rem',
              borderRadius: '2px',
              border: '1px solid rgba(240,235,224,0.1)',
              fontSize: isEncrypted ? '0.9rem' : '1.2rem',
              wordBreak: 'break-all',
              lineHeight: '1.4',
              color: isEncrypted ? '#27AE60' : '#F0EBE0',
              position: 'relative',
              marginBottom: '2rem'
            }}>
              {voucherCode}
              
              <button 
                onClick={copyToClipboard}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'transparent',
                  border: '1px solid rgba(240,235,224,0.2)',
                  color: '#F0EBE0',
                  padding: '0.5rem 1rem',
                  fontSize: '0.6rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  zIndex: 2,
                  backdropFilter: 'blur(5px)'
                }}
                className="mono hover-bright"
              >
                {copied ? '[ COPIED_TO_BUFFER ]' : '[ COPY_SECRET ]'}
              </button>
            </div>
          </div>

          <div className="grid-asymmetric" style={{ gap: '1.5rem' }}>
            <div style={{ gridColumn: '1 / span 7' }}>
              <div className="mono" style={{ fontSize: '0.6rem', opacity: 0.4, marginBottom: '0.5rem' }}>RECIPIENT_CLAIM_WINDOW</div>
              <div className="mono" style={{ fontSize: '0.8rem', color: '#27AE60' }}>
                ● INSTANT_ACCESS_GRANTEED
              </div>
            </div>
            <div style={{ gridColumn: '8 / span 5', textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: '0.6rem', opacity: 0.4, marginBottom: '0.5rem' }}>SENDER_REFUND_LOCK</div>
              <div className="mono" style={{ fontSize: '0.8rem' }}>
                {lockDuration === 0 ? 'UNLOCKED' : new Date(Date.now() + lockDuration * 1000).toLocaleString()}
              </div>
            </div>
            {txHash && (
              <div style={{ gridColumn: '1 / span 12', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(240,235,224,0.05)' }}>
                <div className="mono" style={{ fontSize: '0.6rem', opacity: 0.4, marginBottom: '0.5rem' }}>ON_CHAIN_PROOFS</div>
                <a href={`https://sepolia.voyager.online/tx/${txHash}`} target="_blank" rel="noreferrer" 
                   style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none' }} className="mono hover-underline">
                  VERIFY_STARKNET_TX_↗
                </a>
              </div>
            )}
          </div>

          <div className="mt-8 p-6" style={{ background: 'rgba(240,235,224,0.03)', border: '1px solid rgba(240,235,224,0.1)', borderRadius: '2px' }}>
            <div className="mono mb-4" style={{ fontSize: '0.65rem', letterSpacing: '0.1em', color: 'var(--accent)' }}>ACCESS_PERMISSIONS_MATRIX</div>
            <div className="grid-asymmetric" style={{ gap: '1rem' }}>
              <div style={{ gridColumn: '1 / span 6' }}>
                <div className="mono" style={{ fontSize: '0.6rem', opacity: 0.4, marginBottom: '0.5rem' }}>RECIPIENT (ANONYMOUS)</div>
                <div className="mono" style={{ fontSize: '0.75rem', color: '#27AE60' }}>
                  [✓] REDEEM // INSTANT<br/>
                  [×] REFUND // UNAUTHORIZED
                </div>
              </div>
              <div style={{ gridColumn: '7 / span 6' }}>
                <div className="mono" style={{ fontSize: '0.6rem', opacity: 0.4, marginBottom: '0.5rem' }}>SENDER (PUBLIC_CREATOR)</div>
                <div className="mono" style={{ fontSize: '0.75rem' }}>
                  [×] REDEEM // PRIVACY_RISK<br/>
                  {lockDuration === 0 ? (
                    <span style={{ color: '#27AE60' }}>[✓] REFUND // AVAILABLE_NOW</span>
                  ) : (
                    <span style={{ opacity: 0.5 }}>[×] REFUND // LOCKED_BY_TIMER</span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 mono" style={{ fontSize: '0.65rem', borderTop: '1px solid rgba(240,235,224,0.05)', opacity: 0.5, lineHeight: '1.4' }}>
              * Only the wallet that created this voucher can perform a refund. Anyone with the secret code (usually the recipient) can redeem it anonymously at any time.
            </div>
          </div>

          <div className="mt-8 p-4" style={{ background: 'rgba(192, 57, 43, 0.1)', borderLeft: '2px solid #C0392B' }}>
            <p className="mono" style={{ fontSize: '0.7rem', lineHeight: '1.5', margin: 0, color: '#F0EBE0' }}>
              <strong style={{ color: '#C0392B' }}>SYSTEM_CRITICAL:</strong> This code is not stored on any server. Loss of this code results in permanent loss of assets unless the sender performs a refund after the lock window expires.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
