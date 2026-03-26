import { createContext, ReactNode, useContext, useMemo, useState } from 'react'

type WalletContextValue = {
  address: string | null
  account: any | null
  isConnected: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

function getInjectedWallet() {
  return (window as any).starknet
}

export function StarknetProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [account, setAccount] = useState<any | null>(null)

  async function connectWallet() {
    const wallet = getInjectedWallet()
    if (!wallet) {
      throw new Error('Braavos/ArgentX wallet not found')
    }

    await wallet.enable({ starknetVersion: 'v5' })
    const nextAddress = wallet.selectedAddress || wallet.account?.address || null
    setAddress(nextAddress)
    setAccount(wallet.account ?? null)
  }

  async function disconnectWallet() {
    const wallet = getInjectedWallet()
    if (wallet?.disconnect) {
      await wallet.disconnect()
    }
    setAddress(null)
    setAccount(null)
  }

  const value = useMemo<WalletContextValue>(() => ({
    address,
    account,
    isConnected: !!address && !!account,
    connectWallet,
    disconnectWallet,
  }), [address, account])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within StarknetProvider')
  }
  return ctx
}

