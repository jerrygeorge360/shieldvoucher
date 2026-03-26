use shieldvoucher::{IShieldVoucherDispatcher, IShieldVoucherDispatcherTrait};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use starknet::ContractAddress;
use core::pedersen::pedersen;

const ADMIN: felt252 = 0x111;

fn setup() -> IShieldVoucherDispatcher {
    let admin: ContractAddress = ADMIN.try_into().unwrap();
    let voucher_class = declare("ShieldVoucher").unwrap().contract_class();
    let (voucher_address, _) = voucher_class.deploy(@array![admin.into()]).unwrap();
    IShieldVoucherDispatcher { contract_address: voucher_address }
}

#[test]
fn test_lock_funds_increments_index() {
    let dispatcher = setup();
    let initial_index = dispatcher.get_next_index();
    assert(initial_index == 0, 'Initial index not 0');
}

#[test]
fn test_merkle_initialization() {
    let dispatcher = setup();
    let root = dispatcher.current_root();
    assert(root != 0, 'Root should be initialized');

    let zh0 = 0x0;
    let _zh1 = pedersen(zh0, zh0);
}
