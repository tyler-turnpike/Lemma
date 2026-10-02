// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ResolutionWarrantyRegistry} from "../src/ResolutionWarrantyRegistry.sol";

/// @notice Registers a Capability Release (admin key).
/// Env:
///   ADMIN_PRIVATE_KEY   key holding DEFAULT_ADMIN_ROLE (falls back to DEPLOYER_PRIVATE_KEY)
///   REGISTRY_ADDRESS    deployed registry
///   RELEASE_ID          bytes32 release id, OR RELEASE_KEY string hashed with keccak256
///                       (e.g. the release key string used offchain)
///   PROVIDER_ADDRESS    bond owner and voucher signer
///   EVALUATOR_ADDRESS   outcome signer
///   RELEASE_PRICE       six-decimal USDC atomic units (e.g. 120000 = 0.12 USDC)
///   CLAIM_WINDOW        optional seconds, default 0 => 72h
contract RegisterRelease is Script {
    function run() external {
        uint256 adminKey =
            vm.envOr("ADMIN_PRIVATE_KEY", vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0)));
        require(adminKey != 0, "RegisterRelease: missing ADMIN_PRIVATE_KEY");
        ResolutionWarrantyRegistry registry =
            ResolutionWarrantyRegistry(vm.envAddress("REGISTRY_ADDRESS"));
        bytes32 releaseId = _releaseId();
        address provider = vm.envAddress("PROVIDER_ADDRESS");
        address evaluator = vm.envAddress("EVALUATOR_ADDRESS");
        uint256 price = vm.envUint("RELEASE_PRICE");
        uint64 claimWindow = uint64(vm.envOr("CLAIM_WINDOW", uint256(0)));

        require(
            registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), vm.addr(adminKey)),
            "RegisterRelease: key is not admin"
        );
        require(provider != evaluator, "RegisterRelease: provider must differ from evaluator");

        vm.startBroadcast(adminKey);
        registry.registerRelease(releaseId, provider, evaluator, price, claimWindow);
        vm.stopBroadcast();

        console2.log("registered release");
        console2.logBytes32(releaseId);
    }

    function _releaseId() internal view returns (bytes32) {
        bytes32 id = vm.envOr("RELEASE_ID", bytes32(0));
        if (id != bytes32(0)) return id;
        string memory key = vm.envString("RELEASE_KEY");
        return keccak256(bytes(key));
    }
}

/// @notice Deposits provider bond (provider key). Approves then deposits.
/// Env: PROVIDER_PRIVATE_KEY, REGISTRY_ADDRESS, RELEASE_ID or RELEASE_KEY, BOND_AMOUNT (6-dec).
contract DepositBond is Script {
    function run() external {
        uint256 providerKey = vm.envUint("PROVIDER_PRIVATE_KEY");
        ResolutionWarrantyRegistry registry =
            ResolutionWarrantyRegistry(vm.envAddress("REGISTRY_ADDRESS"));
        bytes32 releaseId = vm.envOr("RELEASE_ID", bytes32(0));
        if (releaseId == bytes32(0)) releaseId = keccak256(bytes(vm.envString("RELEASE_KEY")));
        uint256 amount = vm.envUint("BOND_AMOUNT");
        IERC20 usdc = registry.usdc();

        vm.startBroadcast(providerKey);
        usdc.approve(address(registry), amount);
        registry.depositBond(releaseId, amount);
        vm.stopBroadcast();

        console2.log("bond deposited", amount);
    }
}
