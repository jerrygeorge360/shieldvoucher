// SPDX-License-Identifier: MIT
// ShieldVoucher — privacy-preserving payment vouchers on Starknet
// Deployed on Starknet Sepolia testnet

mod tests;
mod mock_wbtc;

use starknet::ContractAddress;
use integrity::{
    Integrity, IntegrityWithConfig, VerifierConfiguration,
    calculate_bootloaded_fact_hash, SHARP_BOOTLOADER_PROGRAM_HASH,
};

// Cairo1 bootloader program hash used by Atlantic (from official examples)
const CAIRO1_BOOTLOADER_PROGRAM_HASH: felt252 =
    0x288ba12915c0c7e91df572cf3ed0c9f391aa673cb247c5a208beaa50b668f09;

// Our circuit's program hash (from Atlantic metadata "child_program_hash")
// This must be updated after any circuit rebuild.
const SHIELD_CIRCUIT_PROGRAM_HASH: felt252 =
    0x54d14be651536beac362c737335e4b0b08c16e6343c0fabf2ef5070e34638ee;

const SECURITY_BITS: u32 = 96;
const IS_MOCKED: bool = false;

// Calculate fact hash for cairo1 programs bootloaded in cairo0 by Atlantic.
// Copied from official Herodotus atlantic-examples/l2-verification-contract.
fn calculate_cairo1_fact_hash(
    program_hash: felt252, input: Span<felt252>, output: Span<felt252>,
) -> felt252 {
    let OUTPUT_CONST = 0x49ee3eba8c1600700ee1b87eb599f16716b0b1022947733551fde4050ca6804;

    let mut bootloader_output = array![
        0x0, OUTPUT_CONST, 0x1, input.len().into() + output.len().into() + 5, program_hash, 0x0,
    ];
    bootloader_output.append(output.len().into());
    for x in output {
        bootloader_output.append(*x);
    };
    bootloader_output.append(input.len().into());
    for x in input {
        bootloader_output.append(*x);
    };

    calculate_bootloaded_fact_hash(
        SHARP_BOOTLOADER_PROGRAM_HASH, CAIRO1_BOOTLOADER_PROGRAM_HASH, bootloader_output.span(),
    )
}

fn get_sharp_config() -> (VerifierConfiguration, u32) {
    let config = VerifierConfiguration {
        layout: 'recursive', hasher: 'keccak_160_lsb', stone_version: 'stone6', memory_verification: 'relaxed',
    };
    (config, SECURITY_BITS)
}

#[starknet::interface]
pub trait IShieldVoucher<TContractState> {
    fn lock_funds(
        ref self: TContractState,
        commitment: felt252,
        token_address: ContractAddress,
        amount: u256,
        lock_duration: u64
    );
    fn redeem(
        ref self: TContractState,
        secret: felt252,
        recipient: ContractAddress
    );
    fn redeem_with_proof(
        ref self: TContractState,
        nullifier: felt252,
        merkle_root: felt252,
        token_address: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        fact_hash: felt252
    );
    fn refund(ref self: TContractState, commitment: felt252);
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
    fn register_merkle_root(ref self: TContractState, root: felt252);
    fn get_next_index(self: @TContractState) -> u32;
    fn current_root(self: @TContractState) -> felt252;
    fn get_voucher(self: @TContractState, commitment: felt252) -> (u256, bool);
    fn get_voucher_token(self: @TContractState, commitment: felt252) -> ContractAddress;
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    fn is_redeemed(self: @TContractState, commitment: felt252) -> bool;
    fn get_lock_until(self: @TContractState, commitment: felt252) -> u64;
    fn admin_pause(ref self: TContractState);
    fn admin_unpause(ref self: TContractState);
}



#[starknet::contract]
mod ShieldVoucher {
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_block_timestamp};
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess};
    use core::pedersen::pedersen;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use core::num::traits::Zero;
    use super::{
        calculate_cairo1_fact_hash, get_sharp_config,
        SHIELD_CIRCUIT_PROGRAM_HASH,
    };
    use integrity::{Integrity, IntegrityWithConfig};

    const STRK_TOKEN: felt252 = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d;
    const WBTC_TOKEN: felt252 = 0x07ed1e249b7392b23940552cfceafd5f613de13cf996ded4c8cfc79a9ddbf580;

    #[storage]
    struct Storage {
        // commitment => locked amount
        voucher_amounts: Map<felt252, u256>,
        // commitment => redeemed flag
        voucher_redeemed: Map<felt252, bool>,
        // commitment => sender (for refund in future extension)
        voucher_senders: Map<felt252, ContractAddress>,
        // commitment => token address (STRK or WBTC)
        voucher_tokens: Map<felt252, ContractAddress>,
        // token => total escrowed amount held by this contract
        escrow_balances: Map<ContractAddress, u256>,

        // nullifier => used flag (prevents double-spend for private redeem)
        nullifier_used: Map<felt252, bool>,
        // valid Merkle roots accepted by verifier circuit
        valid_roots: Map<felt252, bool>,

        // contract admin (for verifier/root configuration)
        admin: ContractAddress,
        // zk verifier contract address
        verifier: ContractAddress,

        // --- MERKLE TREE STORAGE ---
        next_index: u32,
        height: u32,
        filled_subtrees: Map<u32, felt252>,
        current_root: felt252,

        // --- PHASE 8 HARDENING ---
        is_paused: bool,
        is_locked: bool,
        is_testnet: bool,
        voucher_lock_until: Map<felt252, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        VoucherCreated: VoucherCreated,
        VoucherRedeemed: VoucherRedeemed,
        VoucherRedeemedPrivate: VoucherRedeemedPrivate,
        VoucherRefunded: VoucherRefunded,
        VerifierUpdated: VerifierUpdated,
        RootRegistered: RootRegistered,
    }

    #[derive(Drop, starknet::Event)]
    struct VoucherCreated {
        commitment: felt252,
        token_address: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct VoucherRedeemed {
        commitment: felt252,
        recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct VoucherRedeemedPrivate {
        nullifier: felt252,
        recipient: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct VoucherRefunded {
        commitment: felt252,
        sender: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct VerifierUpdated {
        verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct RootRegistered {
        root: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, 
        admin: ContractAddress, 
        verifier: ContractAddress,
        is_testnet: bool
    ) {
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.is_testnet.write(is_testnet);
        
        // Initialize Merkle Tree (Height 20)
        self.height.write(20);
        self.next_index.write(0);
        
        let root = self._initialize_empty_tree();
        self.current_root.write(root);
        self.valid_roots.write(root, true);
    }

    #[abi(embed_v0)]
    impl ShieldVoucherImpl of super::IShieldVoucher<ContractState> {
        fn lock_funds(
            ref self: ContractState,
            commitment: felt252,
            token_address: ContractAddress,
            amount: u256,
            lock_duration: u64
        ) {
            assert(!self.is_paused.read(), 'Contract paused');
            assert(amount > 0, 'Amount must be > 0');
            
            // Refund time lock validation (1hr - 30 days)
            // PH-10: Allow instant refund (0s) if is_testnet is true
            if self.is_testnet.read() && lock_duration == 0 {
                // Allowed
            } else {
                assert(lock_duration >= 3600, 'Lock duration too short');
                assert(lock_duration <= 2592000, 'Lock duration too long');
            }

            assert(
                self.voucher_amounts.read(commitment) == 0,
                'Commitment already exists'
            );
            assert_supported_token(token_address);

            let caller = get_caller_address();
            let this_contract = get_contract_address();
            let ierc20 = IERC20Dispatcher { contract_address: token_address };

            assert(
                ierc20.transfer_from(caller, this_contract, amount),
                'Transfer failed'
            );

            increase_escrow(ref self, token_address, amount);

            self.voucher_amounts.write(commitment, amount);
            self.voucher_senders.write(commitment, caller);
            self.voucher_redeemed.write(commitment, false);
            self.voucher_tokens.write(commitment, token_address);
            self.voucher_lock_until.write(commitment, get_block_timestamp() + lock_duration);

            // ANONYMITY UPGRADE: Insert into Merkle Tree
            let new_root = self._insert_into_tree(commitment, self.next_index.read());
            self.current_root.write(new_root);
            self.valid_roots.write(new_root, true);
            self.next_index.write(self.next_index.read() + 1);

            self.emit(VoucherCreated { commitment, token_address, amount });
        }

        fn redeem(
            ref self: ContractState,
            secret: felt252,
            recipient: ContractAddress
        ) {
            assert(false, 'Legacy redeem disabled');
        }

        fn redeem_with_proof(
            ref self: ContractState,
            nullifier: felt252,
            merkle_root: felt252,
            token_address: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
            fact_hash: felt252
        ) {
            assert(!self.is_paused.read(), 'Contract paused');
            assert(!self.is_locked.read(), 'Reentrancy guard');
            self.is_locked.write(true);

            assert(!recipient.is_zero(), 'Invalid recipient');
            assert(amount > 0, 'Amount must be > 0');
            assert_supported_token(token_address);
            assert(!self.nullifier_used.read(nullifier), 'Nullifier used');
            assert(self.valid_roots.read(merkle_root), 'Invalid root');

            // Verify the STARK proof was verified on L2 via Herodotus Integrity.
            // The fact_hash is computed off-chain from Atlantic job metadata,
            // preserving privacy by keeping circuit inputs (secret, merkle_path) off-chain.
            let (config, security_bits) = get_sharp_config();
            let integrity = Integrity::new();
            let is_valid = integrity
                .with_config(config, security_bits)
                .is_fact_hash_valid(fact_hash);
            assert(is_valid, 'Proof not verified on L2');

            // --- EFFECTS (State update before interaction) ---
            self.nullifier_used.write(nullifier, true);
            decrease_escrow(ref self, token_address, amount);

            // --- INTERACTIONS ---
            let ierc20 = IERC20Dispatcher { contract_address: token_address };
            assert(ierc20.transfer(recipient, amount), 'Transfer failed');

            self.emit(VoucherRedeemedPrivate {
                nullifier,
                recipient,
                token_address,
                amount,
            });

            self.is_locked.write(false);
        }

        fn refund(ref self: ContractState, commitment: felt252) {
            assert(!self.is_locked.read(), 'Reentrancy guard');
            self.is_locked.write(true);

            let caller = get_caller_address();
            let sender = self.voucher_senders.read(commitment);
            let amount = self.voucher_amounts.read(commitment);
            let token_address = self.voucher_tokens.read(commitment);

            assert(sender == caller, 'Not voucher sender');
            assert(amount > 0, 'Voucher not found');
            assert(!self.voucher_redeemed.read(commitment), 'Already redeemed');
            
            // Refund time lock check
            let unlock_time = self.voucher_lock_until.read(commitment);
            assert(get_block_timestamp() >= unlock_time, 'Escrow still locked');

            // --- EFFECTS ---
            self.voucher_redeemed.write(commitment, true);
            decrease_escrow(ref self, token_address, amount);

            // --- INTERACTIONS ---
            let ierc20 = IERC20Dispatcher { contract_address: token_address };
            assert(ierc20.transfer(caller, amount), 'Transfer failed');

            self.emit(VoucherRefunded { commitment, sender, token_address, amount });
            
            self.is_locked.write(false);
        }

        fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            assert_admin(@self);
            self.verifier.write(verifier);
            self.emit(VerifierUpdated { verifier });
        }

        fn register_merkle_root(ref self: ContractState, root: felt252) {
            assert_admin(@self);
            self.valid_roots.write(root, true);
            self.emit(RootRegistered { root });
        }

        fn get_voucher(self: @ContractState, commitment: felt252) -> (u256, bool) {
            (self.voucher_amounts.read(commitment), self.voucher_redeemed.read(commitment))
        }

        fn get_voucher_token(self: @ContractState, commitment: felt252) -> ContractAddress {
            self.voucher_tokens.read(commitment)
        }

        fn get_next_index(self: @ContractState) -> u32 {
            self.next_index.read()
        }

        fn current_root(self: @ContractState) -> felt252 {
            self.current_root.read()
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifier_used.read(nullifier)
        }

        fn is_redeemed(self: @ContractState, commitment: felt252) -> bool {
            self.voucher_redeemed.read(commitment)
        }

        fn get_lock_until(self: @ContractState, commitment: felt252) -> u64 {
            self.voucher_lock_until.read(commitment)
        }

        fn admin_pause(ref self: ContractState) {
            assert(get_caller_address() == self.admin.read(), 'Only admin');
            self.is_paused.write(true);
        }

        fn admin_unpause(ref self: ContractState) {
            assert(get_caller_address() == self.admin.read(), 'Only admin');
            self.is_paused.write(false);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _initialize_empty_tree(ref self: ContractState) -> felt252 {
            let mut current_hash = 0x0;
            let mut i: u32 = 0;
            loop {
                if i >= 20 { break; }
                self.filled_subtrees.write(i, current_hash);
                current_hash = pedersen(current_hash, current_hash);
                i += 1;
            };
            current_hash
        }

        fn _insert_into_tree(ref self: ContractState, leaf: felt252, current_index: u32) -> felt252 {
            let mut current_index = current_index;
            let mut current_hash = leaf;
            let mut i: u32 = 0;
            let height = self.height.read();

            loop {
                if i >= height { break; }
                if current_index % 2 == 0 {
                    self.filled_subtrees.write(i, current_hash);
                    current_hash = pedersen(current_hash, self._get_empty_hash(i));
                } else {
                    current_hash = pedersen(self.filled_subtrees.read(i), current_hash);
                }
                current_index /= 2;
                i += 1;
            };
            current_hash
        }

        fn _get_empty_hash(self: @ContractState, level: u32) -> felt252 {
            if level == 0 { return 0x0; }
            let mut h = 0x0;
            let mut j = 0;
            loop {
                if j >= level { break; }
                h = pedersen(h, h);
                j += 1;
            };
            h
        }
    }

    fn assert_supported_token(token_address: ContractAddress) {
        let token_felt: felt252 = token_address.into();
        assert(token_felt == STRK_TOKEN || token_felt == WBTC_TOKEN, 'Unsupported token');
    }

    fn increase_escrow(ref self: ContractState, token_address: ContractAddress, amount: u256) {
        let current = self.escrow_balances.read(token_address);
        self.escrow_balances.write(token_address, current + amount);
    }

    fn decrease_escrow(ref self: ContractState, token_address: ContractAddress, amount: u256) {
        let current = self.escrow_balances.read(token_address);
        assert(current >= amount, 'Insufficient pool');
        self.escrow_balances.write(token_address, current - amount);
    }

    fn assert_admin(self: @ContractState) {
        assert(get_caller_address() == self.admin.read(), 'Not admin');
    }
}
