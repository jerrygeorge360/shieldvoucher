# ShieldVoucher: Private Bitcoin Payment Layer on Starknet

ShieldVoucher is a privacy-preserving payment system for Bitcoin on Starknet. Deposit WBTC, receive a shield code, and redeem to any wallet -- with zero on-chain link between sender and recipient.

Privacy is enforced by a Cairo ZK circuit verified on-chain via Herodotus Atlantic STARK proofs and the Integrity FactRegistry. The secret never touches the chain.

Built for the **PL Genesis Hackathon** -- Starknet Privacy Track ($5,000 prize pool).

---

## Table of Contents
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Privacy Guarantees](#privacy-guarantees)
- [Starknet Integration](#starknet-integration)
- [Deployment](#deployment)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Usage](#usage)

---

## How It Works

### The Problem
On-chain transfers are fully transparent. Anyone can trace who sent funds to whom. ShieldVoucher breaks this link using zero-knowledge proofs.

### Deposit (Shielding)
1. The frontend generates a random **secret** locally (never leaves the browser)
2. A positional **nullifier** is derived: `nullifier = pedersen(secret, leaf_index)`
3. A **commitment** is computed: `commitment = pedersen(secret, nullifier)`
4. The commitment is appended to an on-chain Merkle tree via `lock_funds()`
5. The user receives a **shield code** containing the secret, nullifier, leaf index, token, and amount

### Redeem (Unshielding)
1. The recipient enters the shield code
2. The frontend reconstructs the Merkle tree by scanning on-chain `VoucherCreated` events
3. A **Cairo ZK circuit** proves: *"I know a secret whose commitment exists in the Merkle tree"*
4. The circuit inputs (secret, merkle path) are sent to **Herodotus Atlantic** for off-chain STARK proof generation
5. Atlantic verifies the proof on Starknet L2 via the **Integrity verifier**, registering a `fact_hash` in the on-chain FactRegistry
6. The frontend retrieves the `integrityFactHash` from Atlantic's response and passes it to the contract
7. The contract calls `Integrity.is_fact_hash_valid(fact_hash)` -- a hard on-chain assert -- then verifies the nullifier is unused and the Merkle root is valid
8. Funds are released to the recipient. The nullifier is permanently marked as spent.

**Result**: An observer sees a deposit and a withdrawal, but cannot determine which deposit corresponds to which withdrawal. The secret never appears on-chain.

---

## Architecture

```
DEPOSIT FLOW
  User
    |-- Generate random secret (browser-side)
    |-- Derive: nullifier = pedersen(secret, leaf_index)
    |-- Derive: commitment = pedersen(secret, nullifier)
    |-- Call lock_funds(commitment, token, amount)
    |-- Merkle tree updated on-chain
    |-- Shield code returned to user (contains secret)

REDEEM FLOW
  Recipient
    |-- Enter shield code
    |-- Reconstruct Merkle tree from on-chain events
    |-- Build circuit inputs: [secret, path_len, ...path, leaf_index, nullifier, root, token, amount, recipient]
    |-- Submit to Herodotus Atlantic API
    |     |-- Step 1: Trace & metadata generation
    |     |-- Step 2: STARK proof generation
    |     |-- Step 3: L2 proof verification (registers fact on Starknet)
    |-- Retrieve integrityFactHash from Atlantic response
    |-- Call redeem_with_proof(nullifier, root, token, amount, recipient, fact_hash)
    |     |-- Contract: assert Integrity.is_fact_hash_valid(fact_hash)  [REAL ON-CHAIN CHECK]
    |     |-- Contract: assert nullifier not used
    |     |-- Contract: assert root is valid
    |     |-- Contract: transfer funds to recipient
    |     |-- Contract: mark nullifier as spent
    |-- Funds released. Zero link to depositor.
```

---

## Privacy Guarantees

| Data | On-chain? | Can it identify the depositor? |
|------|-----------|-------------------------------|
| Secret | Never | N/A -- stays in shield code |
| Merkle path | Never | N/A -- stays in circuit input |
| Commitment | Yes (deposit tx) | No -- one-way hash, can't reverse |
| Nullifier | Yes (redeem tx) | No -- derived from secret + index, can't reverse |
| Merkle root | Yes (redeem tx) | No -- public contract state |
| fact_hash | Yes (redeem tx) | No -- opaque Integrity receipt |
| Recipient | Yes (redeem tx) | Identifies redeemer only, not depositor |

**Key insight**: The ZK proof proves knowledge of the secret without revealing it. The `fact_hash` is an opaque receipt from Integrity confirming the proof was verified on Starknet. Private circuit inputs (secret, merkle path) are intentionally kept off-chain to preserve depositor-redeemer unlinkability.

### Double-Spend Prevention
Each voucher produces a unique nullifier (`pedersen(secret, leaf_index)`). Once redeemed, the nullifier is permanently marked as used. Any attempt to redeem the same voucher reverts with `'Nullifier used'`.

---

## Starknet Integration

ShieldVoucher leverages Starknet's ecosystem at every layer:

| Component | How It's Used |
|-----------|---------------|
| **Cairo 1.0 Smart Contract** | Core contract with Merkle tree, nullifier tracking, escrow logic |
| **Cairo 1.0 ZK Circuit** | Pedersen commitment verification + Merkle proof in a provable program |
| **Pedersen Hashing** | Starknet-native hash for commitments, nullifiers, and Merkle tree nodes |
| **Herodotus Atlantic** | Off-chain STARK proof generation with on-chain L2 fact registration |
| **Integrity Verifier** | On-chain FactRegistry check via `is_fact_hash_valid()` (hard assert) |
| **Starknet.js** | Frontend wallet integration with ArgentX and Braavos |

### Why Starknet?
1. **Cryptographic alignment**: Starknet's native Pedersen hashing matches our circuit primitives, ensuring high performance
2. **Atlantic prover**: Starknet-native infrastructure for off-chain STARK proof generation and on-chain fact registration
3. **Cost efficiency**: Complex ZK verification is orders of magnitude cheaper on Starknet L2 than Ethereum L1
4. **Bitcoin infrastructure**: Starknet is actively building WBTC/strkBTC support for Bitcoin-on-L2

---

## Deployment

**Network**: Starknet Sepolia Testnet

| Component | Address |
|-----------|---------|
| **ShieldVoucher Contract** | [`0x07739da35f61c04790dd4ab1bf8a41fb479c412daaa8d23f9d044fbf1098896b`](https://sepolia.voyager.online/contract/0x07739da35f61c04790dd4ab1bf8a41fb479c412daaa8d23f9d044fbf1098896b) |
| **Mock WBTC Token** | [`0x07ed1e249b7392b23940552cfceafd5f613de13cf996ded4c8cfc79a9ddbf580`](https://sepolia.voyager.online/contract/0x07ed1e249b7392b23940552cfceafd5f613de13cf996ded4c8cfc79a9ddbf580) |
| **Integrity Satellite** | [`0x00421cd95f9ddabdd090db74c9429f257cb6bc1ccc339278d1db1de39156676e`](https://sepolia.voyager.online/contract/0x00421cd95f9ddabdd090db74c9429f257cb6bc1ccc339278d1db1de39156676e) |

**Example verified redemption**: [`0x547c214a...e30c5`](https://sepolia.voyager.online/tx/0x547c214a9703091b5ef1e7f1283ef8dc80431e12ade787579d4a59dda9e30c5) -- real on-chain Integrity verification, no mocks.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Cairo 1.0 (Scarb 2.16.0, Starknet Foundry v0.57.0) |
| ZK Circuit | Cairo 1.0 library target, executed via Herodotus Atlantic |
| On-chain Verification | Herodotus `integrity = "2.0.0"` crate (`is_fact_hash_valid`) |
| Frontend | React 18 + TypeScript + Vite |
| Wallet | ArgentX, Braavos (via `starknetkit`) |
| RPC Provider | Alchemy (Starknet Sepolia) |
| Proof API | Herodotus Atlantic (`PROOF_VERIFICATION_ON_L2`) |

---

## Project Structure

```
shieldvoucher/
  contracts/                    # Cairo smart contract
    src/
      lib.cairo                 # Main contract: Merkle tree, Integrity verification, redemption
      mock_wbtc.cairo           # Test WBTC token
      tests.cairo               # Contract unit tests
    Scarb.toml                  # Deps: starknet, integrity 2.0.0, openzeppelin
  circuit/                      # ZK circuit for Atlantic
    src/
      lib.cairo                 # Pedersen commitment + Merkle proof verification circuit
    Scarb.toml
  frontend/                     # React frontend
    src/
      api/
        atlantic.ts             # Atlantic API: submit, poll, extract integrityFactHash
        circuit_data.ts         # Compiled circuit Sierra (base64)
      components/
        CreateVoucher.tsx       # Deposit: generate secret, derive commitment, lock funds
        RedeemVoucher.tsx       # Redeem: reconstruct tree, prove, verify, release
        SendVoucher.tsx         # Send: approve + lock in one flow
      hooks/
        useShieldVoucher.ts     # Contract interaction: lock, redeem, events, state
      utils/
        merkle.ts               # Incremental Pedersen Merkle tree (20 levels)
```

---

## Setup

### Prerequisites
- [Scarb](https://docs.swmansion.com/scarb/) (Cairo package manager)
- [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/) v0.57.0
- Node.js 18+
- Starknet wallet (ArgentX or Braavos) on Sepolia testnet
- [Herodotus Atlantic API key](https://dashboard.herodotus.dev/)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/jerrygeorge360/shieldvoucher.git
cd shieldvoucher

# 2. Install frontend dependencies
cd frontend && npm install

# 3. Build smart contract
cd ../contracts && scarb build

# 4. Build ZK circuit
cd ../circuit && scarb build

# 5. Configure environment
cat > frontend/.env << EOF
VITE_CONTRACT_ADDRESS=0x07739da35f61c04790dd4ab1bf8a41fb479c412daaa8d23f9d044fbf1098896b
VITE_RPC_URL=<your-starknet-sepolia-rpc-url>
VITE_ATLANTIC_API_KEY=<your-herodotus-atlantic-api-key>
EOF

# 6. Run the application
cd frontend && npm run dev
```

---

## Usage

### 1. Shield (Deposit)
- Connect your Starknet wallet (ArgentX or Braavos)
- Select WBTC and enter an amount
- Click "Generate Protected Voucher"
- Save the generated `zk:` shield code securely

### 2. Transfer
- Send the shield code to the recipient via any channel (messaging, email, QR code)
- The code is the only thing needed to redeem -- no account relationship required

### 3. Unshield (Redeem)
- Enter the shield code in the "Redeem" tab
- The app reconstructs the Merkle tree from on-chain events
- Runs pre-flight checks (nullifier, Merkle proof, root match)
- Submits the ZK circuit to Atlantic for STARK proof generation (~5-10 min)
- Atlantic verifies the proof on Starknet L2 and registers the fact
- The contract verifies the fact hash via Integrity and releases funds
- Total redemption time: ~10-15 minutes (proof generation + L2 verification)

---

## Key Features

- **Real on-chain ZK verification** -- `Integrity.is_fact_hash_valid()` with hard assert, no mocks
- **Depositor-redeemer unlinkability** -- no on-chain data connects deposit to withdrawal
- **Private circuit inputs** -- secret and merkle path never touch the chain
- **STARK proof generation** -- real cryptographic proofs via Herodotus Atlantic
- **Double-spend protection** -- nullifier-based system prevents voucher reuse
- **Incremental Merkle tree** -- gas-efficient on-chain commitment storage (20 levels, 1M+ capacity)
- **Pre-flight validation** -- local checks before submitting to Atlantic (saves time and API calls)

---

## Security Considerations

- **Fact hash as opaque token**: The `integrityFactHash` is passed from Atlantic to the contract. While the contract doesn't recompute it from inputs (to preserve privacy), it verifies the hash is registered in Integrity's FactRegistry, proving a valid STARK proof was verified on Starknet.
- **Nullifier uniqueness**: Each voucher has a deterministic nullifier. Double-redemption is impossible.
- **Root validation**: The contract only accepts Merkle roots that were previously registered, preventing fake tree attacks.
- **Testnet deployment**: Current deployment is on Sepolia testnet. Production deployment would require security audit.

---

## License

MIT. Built for the **PL Genesis Hackathon**.
