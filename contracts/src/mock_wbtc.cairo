use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockWBTC<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

#[starknet::contract]
mod MockWBTC {
    use openzeppelin::token::erc20::ERC20Component;
    use openzeppelin::token::erc20::ERC20Component::InternalTrait;
    use starknet::ContractAddress;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    #[abi(embed_v0)]
    impl ERC20Impl = ERC20Component::ERC20Impl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;
    impl ERC20HooksImpl of ERC20Component::ERC20HooksTrait<ContractState> {}

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.erc20.initializer("Wrapped Bitcoin", "WBTC");
    }

    #[abi(embed_v0)]
    impl ERC20MetadataImpl of openzeppelin::token::erc20::interface::IERC20Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "Wrapped Bitcoin"
        }
        fn symbol(self: @ContractState) -> ByteArray {
            "WBTC"
        }
        fn decimals(self: @ContractState) -> u8 {
            8
        }
    }

    #[abi(embed_v0)]
    impl MockWBTCImpl of super::IMockWBTC<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.erc20.mint(recipient, amount);
        }
    }
}
