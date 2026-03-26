// Mock verifier — kept for backward compatibility but no longer used.
// Real verification is done via Herodotus Integrity FactRegistry.

#[starknet::contract]
mod MockVerifier {
    #[storage]
    struct Storage {}
}
