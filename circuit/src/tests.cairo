use core::pedersen::pedersen;
use shield_circuit::main;

#[test]
fn test_circuit_valid_inclusion() {
    let secret: felt252 = 0x123;
    let leaf_index: felt252 = 0;
    
    // Derive nullifier and commitment exactly as the scheme demands
    let nullifier = pedersen(secret, leaf_index);
    let commitment = pedersen(secret, nullifier);
    
    // Build a mock Merkle path for index 0 (all siblings are zero hashes)
    let mut merkle_path_flat: Array<felt252> = array![];
    let mut i: u32 = 0;
    let mut current_zero: felt252 = 0x0;
    loop {
        if i >= 20 { break; }
        merkle_path_flat.append(current_zero);
        current_zero = pedersen(current_zero, current_zero);
        i += 1;
    };
    
    // Calculate the expected root for this single leaf at index 0
    let mut expected_root = commitment;
    let mut j: u32 = 0;
    let mut cz: felt252 = 0x0;
    loop {
        if j >= 20 { break; }
        expected_root = pedersen(expected_root, cz);
        cz = pedersen(cz, cz);
        j += 1;
    };

    // Build the flat input array
    let mut input: Array<felt252> = array![];
    input.append(secret);           // [0] secret
    input.append(20);               // [1] path_len
    let mut k: u32 = 0;
    let mut cz2: felt252 = 0x0;
    loop {
        if k >= 20 { break; }
        input.append(cz2);          // [2..21] path elements
        cz2 = pedersen(cz2, cz2);
        k += 1;
    };
    input.append(leaf_index);       // [22] leaf_index
    input.append(nullifier);        // [23] nullifier
    input.append(expected_root);    // [24] merkle_root
    input.append(0x111);            // [25] token_address
    input.append(100);              // [26] amount_low
    input.append(0);                // [27] amount_high
    input.append(0x222);            // [28] recipient

    let output = main(input);
    
    assert(*output[0] == nullifier, 'Wrong nullifier output');
    assert(*output[1] == expected_root, 'Wrong root output');
    assert(*output[2] == 0x111, 'Wrong token output');
    assert(*output[3] == 100, 'Wrong amount_low output');
}
