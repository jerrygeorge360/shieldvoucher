import { useState } from 'react'
import { SendVoucher } from './components/SendVoucher'
import { RedeemVoucher } from './components/RedeemVoucher'
import { VoucherArt } from './components/VoucherArt'
import { useWallet } from './starknet-provider'
import './App.css'
import logo from './utils/logo.svg'

function App() {
  const [tab, setTab] = useState<'send' | 'redeem'>('send')
  const { address, isConnected, connectWallet, disconnectWallet } = useWallet()

  async function handleConnect() {
    try {
      await connectWallet()
    } catch (error) {
      console.error(error)
      alert('Could not connect wallet. Please open Braavos/ArgentX and try again.')
    }
  }

  return (
    <div className="app-container">
      <nav className="header-nav">
        <div className="logo cont">
           <div>
            <img src={logo} alt="Shield Voucher Logo" width={48} height={48} /> 
           </div>
           <div>
            <h3 className="logo mono">SHIELD_VOUCHER_V1.0</h3>
           </div>
        </div>
        <div className="wallet-controls">
          {isConnected ? (
            <button className="btn mono" onClick={disconnectWallet}>
              {address?.slice(0, 6)}_{address?.slice(-4)} // DISCONNECT
            </button>
          ) : (
            <button className="btn btn-accent mono" onClick={handleConnect}>
              INITIATE_WALLET_CONNECTION
            </button>
          )}
        </div>
      </nav>

      <section className="section" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
        <h1 className="hero-large mb-1 animate-hero" style={{ zIndex: 10 }}>PRIVACY</h1>
        <div className="grid-asymmetric reveal-stagger">
          <div style={{ gridColumn: '1 / span 4' }}>
            <VoucherArt />
          </div>
          <div style={{ gridColumn: '7 / span 6' }}>
            <h2 className="hero-medium mb-2">Unbiased, unlinked transactions on Starknet.</h2>
            <p className="text-muted" style={{ maxWidth: '400px' }}>
              Every movement of value on a public ledger creates a permanent shadow. ShieldVoucher severs the link between origin and destination using mathematical commitments.
            </p>
          </div>
        </div>
      </section>

      <section className="section bg-light" style={{ background: '#F0EBE0', color: '#0D0D0D' }}>
        <div className="grid-asymmetric reveal-stagger">
          <div style={{ gridColumn: '1 / span 4' }}>
            <span className="editorial-number animate-fade-in-up">01</span>
            <h3 className="hero-medium mb-1 animate-fade-in-up">The Mechanism</h3>
            <p className="mono animate-fade-in-up" style={{ fontSize: '0.9rem' }}>
              COMMITMENT = PEDERSEN(SECRET, RECIPIENT_ADDRESS)
            </p>
          </div>
          <div style={{ gridColumn: '6 / span 7' }} className="animate-fade-in-up">
            <p style={{ fontSize: '1.5rem' }}>
              We don't store your identity. We store a hash. The sender locks funds against a commitment. The receiver proves knowledge of the secret code. On-chain, the two events are distinct, separate, and anonymous.
            </p>
          </div>
        </div>
      </section>

      <main className="section" style={{ borderBottom: 'none' }}>
        <div className="tabs-editorial reveal-stagger">
          <span
            className={`tab-link ${tab === 'send' ? 'active' : ''}`}
            onClick={() => setTab('send')}
          >
            SEND
          </span>
          <span
            className={`tab-link ${tab === 'redeem' ? 'active' : ''}`}
            onClick={() => setTab('redeem')}
          >
            REDEEM
          </span>
        </div>

        <div className="tab-content tab-transition-enter" key={tab} style={{ marginTop: '2rem' }}>
          {tab === 'send' && <SendVoucher connectedAddress={address} />}
          {tab === 'redeem' && <RedeemVoucher connectedAddress={address} />}
        </div>
      </main>

      <footer className="section mono" style={{ opacity: 0.3, fontSize: '0.75rem', textAlign: 'center' }}>
        STARKNET_SEPOLIA // BUILT_FOR_PRIVACY // ©2026_SHIELDVOUCHER
      </footer>
    </div>
  )
}

export default App
