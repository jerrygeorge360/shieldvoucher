import { cairo, CallData, Contract, RpcProvider } from 'starknet'

const SHIELD_VOUCHER_ABI = [
  {
    type: 'function',
    name: 'lock_funds',
    inputs: [
      { name: 'commitment', type: 'core::felt252' },
      { name: 'token_address', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'lock_duration', type: 'core::integer::u64' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'redeem',
    inputs: [
      { name: 'secret', type: 'core::felt252' },
      { name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'redeem_with_proof',
    inputs: [
      { name: 'nullifier', type: 'core::felt252' },
      { name: 'merkle_root', type: 'core::felt252' },
      { name: 'token_address', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'get_voucher',
    inputs: [{ name: 'commitment', type: 'core::felt252' }],
    outputs: [
      {
        type: 'core::tuple',
        inner: ['core::integer::u256', 'core::bool'],
      },
    ],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_voucher_token',
    inputs: [{ name: 'commitment', type: 'core::felt252' }],
    outputs: [{ name: 'token', type: 'core::starknet::contract_address::ContractAddress' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'current_root',
    inputs: [],
    outputs: [{ name: 'res', type: 'core::felt252' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_next_index',
    inputs: [],
    outputs: [{ name: 'res', type: 'core::integer::u32' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_lock_until',
    inputs: [{ name: 'commitment', type: 'core::felt252' }],
    outputs: [{ name: 'res', type: 'core::integer::u64' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'admin_pause',
    inputs: [],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'admin_unpause',
    inputs: [],
    outputs: [],
    state_mutability: 'external',
  },
] as const

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [{ type: 'core::bool' }],
    state_mutability: 'external',
  },
] as const

const provider = new RpcProvider({ nodeUrl: import.meta.env.VITE_RPC_URL })

export const TOKENS = {
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  WBTC: '0x07ed1e249b7392b23940552cfceafd5f613de13cf996ded4c8cfc79a9ddbf580',
} as const

export const TOKEN_DECIMALS = {
  STRK: 18,
  WBTC: 8,
} as const

export type SupportedToken = keyof typeof TOKENS

export function getShieldVoucherContractAddress() {
  return import.meta.env.VITE_CONTRACT_ADDRESS as string
}

export async function approveToken(
  account: any,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
) {
  const amountU256 = cairo.uint256(amount)
  const erc20 = new Contract({ abi: ERC20_ABI as any, address: tokenAddress, providerOrAccount: account })
  const tx = await erc20.invoke('approve', CallData.compile({
    spender: spenderAddress,
    amount: amountU256,
  }))
  await waitForTransactionWithTimeout(tx.transaction_hash)
  return tx.transaction_hash as string
}

async function waitForTransactionWithTimeout(txHash: string, timeoutMs: number = 60000) {
  return Promise.race([
    provider.waitForTransaction(txHash),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Transaction confirmation timed out (${timeoutMs}ms). Check explorer for hash: ${txHash}`)), timeoutMs))
  ])
}


export async function lockFunds(
  account: any,
  commitment: string,
  tokenAddress: string,
  amount: bigint,
  lockDuration: number
) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: account })
  const tx = await voucher.invoke('lock_funds', CallData.compile({
    commitment,
    token_address: tokenAddress,
    amount: cairo.uint256(amount),
    lock_duration: lockDuration,
  }))
  await waitForTransactionWithTimeout(tx.transaction_hash)
  return tx.transaction_hash as string
}

export async function redeemVoucher(
  account: any,
  secret: string,
  recipient: string,
) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: account })
  const tx = await voucher.invoke('redeem', CallData.compile({
    secret,
    recipient,
  }))
  await provider.waitForTransaction(tx.transaction_hash)
  return tx.transaction_hash as string
}

export async function redeemVoucherWithProof(
  account: any,
  nullifier: string,
  merkleRoot: string,
  tokenAddress: string,
  amount: bigint,
  recipient: string,
  factHash: string
) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: account })
  const tx = await voucher.invoke('redeem_with_proof', CallData.compile({
    nullifier,
    merkle_root: merkleRoot,
    token_address: tokenAddress,
    amount: cairo.uint256(amount),
    recipient,
    fact_hash: factHash,
  }))

  await provider.waitForTransaction(tx.transaction_hash)
  return tx.transaction_hash as string
}

export async function getVoucher(commitment: string) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: provider })
  const result = await voucher.call('get_voucher', CallData.compile({ commitment }))
  return result
}

export async function fetchVoucherEvents() {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: provider })

  try {
    const [root, nextIdx] = await Promise.all([
      voucher.call('current_root'),
      voucher.call('get_next_index')
    ])
    console.debug('CRYPTO_DIAG: On-chain State:', {
      address: contractAddress,
      nextIndex: (nextIdx as any).res?.toString() || nextIdx.toString(),
      root: (root as any).res?.toString() || root.toString()
    })
  } catch (e) {
    console.warn('CRYPTO_DIAG: Failed to fetch on-chain state:', e)
  }

  // Strategy: Use keys filter to let the RPC filter VoucherCreated events server-side.
  // This allows larger block ranges since the RPC only returns matching events.
  const VOUCHER_CREATED_SELECTOR = '0x' + BigInt(
    (await import('starknet')).hash.getSelectorFromName('VoucherCreated')
  ).toString(16)

  const allEvents: any[] = []

  // Approach 1: Try full-range query with keys filter + pagination
  console.debug('EVENT_SCAN: Trying full-range query with keys filter...')
  let continuationToken: string | undefined = undefined
  let fullRangeWorked = false
  try {
    do {
      const params: any = {
        address: contractAddress,
        from_block: { block_number: 0 },
        to_block: 'latest',
        keys: [[VOUCHER_CREATED_SELECTOR]],
        chunk_size: 1000,
      }
      if (continuationToken) {
        params.continuation_token = continuationToken
      }
      const result = await provider.getEvents(params)
      if (result.events && result.events.length > 0) {
        allEvents.push(...result.events)
        fullRangeWorked = true
      }
      continuationToken = result.continuation_token
    } while (continuationToken)
  } catch (e) {
    console.warn('EVENT_SCAN: Full-range query failed, falling back to chunked scan:', e)
  }

  // Approach 2: If full-range returned nothing, chunk backwards through ALL blocks
  if (allEvents.length === 0 && !fullRangeWorked) {
    const latestBlock = await provider.getBlockNumber()
    const CHUNK_SIZE = 50000
    let toBlock = latestBlock

    console.debug(`EVENT_SCAN: Chunked scan from block ${toBlock} to 0`)

    while (toBlock > 0) {
      const fromBlock = Math.max(0, toBlock - CHUNK_SIZE)
      let ct: string | undefined = undefined
      do {
        const params: any = {
          address: contractAddress,
          from_block: { block_number: fromBlock },
          to_block: { block_number: toBlock },
          keys: [[VOUCHER_CREATED_SELECTOR]],
          chunk_size: 1000,
        }
        if (ct) params.continuation_token = ct
        const result = await provider.getEvents(params)
        if (result.events && result.events.length > 0) {
          allEvents.push(...result.events)
        }
        ct = result.continuation_token
      } while (ct)

      toBlock = fromBlock - 1
    }

    // Sort chronologically since we scanned backwards
    allEvents.sort((a, b) => (a.block_number || 0) - (b.block_number || 0))
  }

  console.debug(`EVENT_SCAN: Total events found: ${allEvents.length}`)
  return allEvents
}

export async function getCurrentRoot() {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: provider })
  const result = await voucher.call('current_root')
  return (result as any).res?.toString() || result.toString()
}

export async function getNextIndex() {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: provider })
  const result = await voucher.call('get_next_index')
  // Depending on starknet.js version/ABI, result might be result.res or result[0]
  return Number((result as any).res?.toString() || result.toString())
}

export async function getLockUntil(commitment: string) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: provider })
  const result = await voucher.call('get_lock_until', CallData.compile({ commitment }))
  return Number((result as any).res?.toString() || result.toString())
}

export async function adminPause(account: any) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: account })
  const tx = await voucher.invoke('admin_pause')
  await provider.waitForTransaction(tx.transaction_hash)
}

export async function adminUnpause(account: any) {
  const contractAddress = getShieldVoucherContractAddress()
  const voucher = new Contract({ abi: SHIELD_VOUCHER_ABI as any, address: contractAddress, providerOrAccount: account })
  const tx = await voucher.invoke('admin_unpause')
  await provider.waitForTransaction(tx.transaction_hash)
}
export async function mintMockWBTC(account: any, recipient: string, amount: bigint) {
  const contract = new Contract({
    abi: [
      {
        type: 'function',
        name: 'mint',
        inputs: [
          { name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
          { name: 'amount', type: 'core::integer::u256' },
        ],
        outputs: [],
        state_mutability: 'external',
      },
    ] as any,
    address: TOKENS.WBTC,
    providerOrAccount: account
  })
  const { transaction_hash } = await contract.mint(recipient, cairo.uint256(amount))
  await provider.waitForTransaction(transaction_hash)
  return transaction_hash
}
