# ShieldVoucher: Private Bitcoin Payment Layer on Starknet

ShieldVoucher is a privacy-preserving payment system for Bitcoin on Starknet. Deposit WBTC, receive a shield code, and redeem to any wallet with zero on-chain link between sender and recipient. Privacy is achieved through zero-knowledge proofs, Pedersen-based Merkle trees, and Herodotus Atlantic STARK proof generation.

Built for the **PL Genesis Hackathon** - Starknet Privacy Track.

---

## How It Works

### The Privacy Problem
On-chain transfers are fully transparent. Anyone can trace who sent funds to whom. ShieldVoucher breaks this link.

### The Solution

**Deposit (Shielding)**
1. User generates a random secret locally
2. A commitment is derived: `commitment = pedersen(secret, nullifier)` where `nullifier = pedersen(secret, leaf_index)`
3. The commitment is inserted into an on-chain Merkle tree
4. User receives a shield code containing the secret (never stored on-chain)

**Redeem (Unshielding)**
1. Recipient enters the shield code
2. The frontend reconstructs the Merkle tree from on-chain events
3. A ZK circuit proves: *"I know a secret corresponding to a valid commitment in the tree"* without revealing which one
4. The STARK proof is generated off-chain via Herodotus Atlantic
5. Atlantic registers the proof on Starknet via the Integrity verifier
6. The contract verifies the nullifier hasn't been used and releases funds
7. The nullifier is marked as spent to prevent double-redemption

**Result**: An observer sees a deposit and a withdrawal, but cannot determine which deposit corresponds to which withdrawal.

---

## Architecture

```
Deposit Flow:
  User -> Generate Secret -> pedersen(secret, nullifier) -> Commitment
       -> lock_funds(commitment) -> Merkle Tree Updated -> Shield Code

Redeem Flow:
  Shield Code -> Reconstruct Merkle Tree (from events)
             -> Build ZK Circuit Inputs (secret, merkle_path, leaf_index)
             -> Submit to Herodotus Atlantic API
             -> STARK Proof Generated (trace -> proof -> L2 verification)
             -> Contract: check nullifier unused + root valid -> Release Funds
```

### Privacy Guarantees
- **Secret**: Never appears on-chain. Stays in the shield code (off-chain).
- **Merkle path**: Not included in transaction calldata. Only public outputs are on-chain.
- **Nullifier**: Deterministically derived from the secret, but cannot be reversed to find the depositor.
- **Anonymity set**: All deposits into the contract form the anonymity set. The more deposits, the stronger the privacy.

### Double-Spend Prevention
Each voucher produces a unique nullifier. Once redeemed, the nullifier is permanently marked as used in contract storage. Any attempt to redeem the same voucher reverts with `'Nullifier used'`.

---

## Starknet Integration

ShieldVoucher leverages Starknet's ecosystem deeply:

| Component | How It's Used |
|-----------|---------------|
| **Cairo 1.0** | Smart contract + ZK circuit written in Cairo |
| **Pedersen Hashing** | Starknet-native hash used for commitments, nullifiers, and Merkle tree |
| **Herodotus Atlantic** | Off-chain STARK proof generation via Atlantic API |
| **Integrity Verifier** | On-chain fact registration and verification via Herodotus Integrity crate |
| **Starknet.js** | Frontend wallet integration (ArgentX, Braavos) |

---

## Deployment (Starknet Sepolia Testnet)

| Component | Address |
|-----------|---------|
| **ShieldVoucher Contract** | `0x03ab92e8b33dccdee63cd80e56de833f510ac4f276fbf02947fd5cdbda17e90d` |
| **Mock WBTC Token** | `0x07ed1e249b7392b23940552cfceafd5f613de13cf996ded4c8cfc79a9ddbf580` |
| **Integrity Satellite (Herodotus)** | `0x00421cd95f9ddabdd090db74c9429f257cb6bc1ccc339278d1db1de39156676e` |

[View Contract on Voyager](https://sepolia.voyager.online/contract/0x03ab92e8b33dccdee63cd80e56de833f510ac4f276fbf02947fd5cdbda17e90d)

---

## Tech Stack

- **Smart Contract**: Cairo 1.0 (Scarb 2.16.0, Starknet Foundry v0.57.0)
- **ZK Circuit**: Cairo 1.0 library target, executed via Herodotus Atlantic
- **On-Chain Verification**: Herodotus Integrity crate (`calculate_cairo1_fact_hash`, `is_fact_hash_valid`)
- **Frontend**: React + TypeScript + Vite
- **Wallet Support**: ArgentX and Braavos
- **Provider**: Starknet.js with Alchemy RPC

---

## Project Structure

```
shieldvoucher/
  contracts/           # Cairo smart contract
    src/
      lib.cairo        # Main contract with Integrity verification
      mock_verifier.cairo
      mock_wbtc.cairo
      tests.cairo
    Scarb.toml         # Dependencies: starknet, integrity, openzeppelin
  circuit/             # ZK circuit for Atlantic
    src/
      lib.cairo        # Pedersen commitment + Merkle proof verification
    Scarb.toml
  frontend/            # React frontend
    src/
      api/
        atlantic.ts    # Atlantic API client (submit, poll, status)
        circuit_data.ts # Compiled circuit Sierra (base64)
      components/
        CreateVoucher.tsx  # Deposit UI
        RedeemVoucher.tsx  # Redemption UI with tree reconstruction
      hooks/
        useShieldVoucher.ts # Contract interaction hooks
      utils/
        merkle.ts      # Incremental Pedersen Merkle tree
```

---

## Setup and Installation

### Prerequisites
- [Scarb](https://docs.swmansion.com/scarb/) (Cairo package manager)
- [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/) (for testing/deployment)
- Node.js 18+
- A Starknet wallet (ArgentX or Braavos) on Sepolia testnet

### 1. Install Frontend Dependencies
```bash
cd frontend && npm install
```

### 2. Build Smart Contract
```bash
cd contracts && scarb build
```

### 3. Build ZK Circuit
```bash
cd circuit && scarb build
```

### 4. Configure Environment
Create `frontend/.env`:
```env
VITE_CONTRACT_ADDRESS=0x03ab92e8b33dccdee63cd80e56de833f510ac4f276fbf02947fd5cdbda17e90d
VITE_RPC_URL=<your-starknet-sepolia-rpc-url>
VITE_ATLANTIC_API_KEY=<your-herodotus-atlantic-api-key>
```

### 5. Run the Application
```bash
cd frontend && npm run dev
```

---

## Usage

1. **Shield (Deposit)**: Connect your wallet, select WBTC, enter an amount, and click "Generate Protected Voucher". Save the generated `zk:` shield code.
2. **Transfer**: Send the shield code to the recipient via any channel (messaging app, email, QR code).
3. **Unshield (Redeem)**: The recipient enters the shield code in the Redeem tab. The app reconstructs the Merkle tree, generates a STARK proof via Atlantic, and releases the funds to their wallet.

---

## Key Features

- **Depositor-Redeemer Unlinkability**: No on-chain data connects the deposit to the withdrawal
- **STARK Proof Generation**: Real cryptographic proofs via Herodotus Atlantic prover
- **On-Chain Fact Verification**: Integrity verifier code integrated for L2 proof verification
- **Double-Spend Protection**: Nullifier-based system prevents voucher reuse
- **Incremental Merkle Tree**: Gas-efficient on-chain commitment storage with 20-level depth
- **Multi-Asset Support**: Designed for WBTC and STRK tokens

---

## Team

- **Jerry** - Full-stack developer

---

## License

MIT
