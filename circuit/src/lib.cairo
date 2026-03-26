

use core::pedersen::pedersen;

// ShieldVoucher ZK Circuit
// 
// Target: Herodotus Atlantic Prover
// Goal: Prove ownership of a voucher (commitment) in the anonymity set (Merkle Tree).
//
// Atlantic requires: fn main(input: Array<felt252>) -> Array<felt252>
//
// Input layout (flat felt252 array):
//   [0]     secret
//   [1]     merkle_path_length (N)
//   [2..2+N-1] merkle_path elements
//   [2+N]   leaf_index
//   [2+N+1] nullifier
//   [2+N+2] merkle_root
//   [2+N+3] token_address
//   [2+N+4] amount_low
//   [2+N+5] amount_high
//   [2+N+6] recipient
fn main(input: Array<felt252>) -> Array<felt252> {
    // Parse inputs
    let secret = *input[0];
    let path_len: u32 = (*input[1]).try_into().expect('Invalid path_len');

    let mut merkle_path: Array<felt252> = array![];
    let mut i: u32 = 0;
    loop {
        if i >= path_len { break; }
        merkle_path.append(*input[2 + i]);
        i += 1;
    };

    let base = 2 + path_len;
    let leaf_index: u32 = (*input[base]).try_into().expect('Invalid leaf_index');
    let nullifier = *input[base + 1];
    let merkle_root = *input[base + 2];
    let token_address = *input[base + 3];
    let amount_low = *input[base + 4];
    let amount_high = *input[base + 5];
    let recipient = *input[base + 6];

    // 1. Verify link between secret, leaf_index and nullifier
    // nullifier = pedersen(secret, leaf_index)
    let expected_nullifier = pedersen(secret, leaf_index.into());
    assert(nullifier == expected_nullifier, 'Circuit: Invalid nullifier');

    // 2. Derive commitment from secret and nullifier
    // commitment = pedersen(secret, nullifier)
    let commitment = pedersen(secret, nullifier);

    // 3. Verify Merkle Path inclusion
    let mut current_hash = commitment;
    let mut current_index = leaf_index;
    let mut j: u32 = 0;

    loop {
        if j >= path_len { break; }
        let sibling = *merkle_path.at(j);
        if current_index % 2 == 0 {
            // Leaf is left child
            current_hash = pedersen(current_hash, sibling);
        } else {
            // Leaf is right child
            current_hash = pedersen(sibling, current_hash);
        }
        current_index /= 2;
        j += 1;
    };

    // 4. Verify calculated root matches the public root
    assert(current_hash == merkle_root, 'Circuit: Invalid Merkle root');

    // 5. Return public outputs
    array![
        nullifier,
        merkle_root,
        token_address,
        amount_low,
        amount_high,
        recipient
    ]
}
