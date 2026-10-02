// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ResolutionWarrantyRegistry} from "../src/ResolutionWarrantyRegistry.sol";

/// @notice Deploys ResolutionWarrantyRegistry.
/// Env:
///   DEPLOYER_PRIVATE_KEY   deployer key (uint)
///   USDC_ADDRESS           USDC token (must be 6 decimals, must have code)
///   REGISTRY_ADMIN_ADDRESS DEFAULT_ADMIN_ROLE holder (registers releases, pauses)
///   EXPECTED_CHAIN_ID      optional, default 421614 (Arbitrum Sepolia)
///   DEPLOYMENT_FILE        optional output path under deployments/ (default
///                          deployments/<chainId>.json). Fork rehearsals set this so they never
///                          overwrite the real Arbitrum Sepolia record.
/// Writes a secret-free record to deployments/<chainId>.json (or DEPLOYMENT_FILE). The transaction
/// hash is in broadcast/Deploy.s.sol/<chainId>/run-latest.json.
contract Deploy is Script {
    uint256 internal constant ARBITRUM_SEPOLIA = 421614;
    address internal constant ARBITRUM_SEPOLIA_USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function run() external returns (ResolutionWarrantyRegistry registry) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address admin = vm.envAddress("REGISTRY_ADMIN_ADDRESS");
        uint256 expectedChainId = vm.envOr("EXPECTED_CHAIN_ID", ARBITRUM_SEPOLIA);

        // Fail closed on wrong chain, token, or role address.
        require(block.chainid == expectedChainId, "Deploy: unexpected chain id");
        if (block.chainid == ARBITRUM_SEPOLIA) {
            require(usdc == ARBITRUM_SEPOLIA_USDC, "Deploy: not Arbitrum Sepolia USDC");
        }
        require(usdc.code.length > 0, "Deploy: USDC has no code");
        require(IERC20Metadata(usdc).decimals() == 6, "Deploy: USDC must have 6 decimals");
        require(admin != address(0), "Deploy: zero admin");

        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);
        registry = new ResolutionWarrantyRegistry(IERC20Metadata(usdc), admin);
        vm.stopBroadcast();

        // Verify constructor results.
        require(address(registry.usdc()) == usdc, "Deploy: usdc mismatch");
        require(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin), "Deploy: admin mismatch");

        console2.log("ResolutionWarrantyRegistry", address(registry));
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("admin", admin);
        console2.log("usdc", usdc);

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "registry", address(registry));
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeAddress(key, "admin", admin);
        vm.serializeUint(key, "blockNumber", block.number);
        vm.serializeBytes32(key, "domainSeparator", registry.domainSeparator());
        vm.serializeString(key, "compiler", "solc 0.8.30, optimizer 200 runs, evm shanghai");
        string memory json =
            vm.serializeString(key, "sourceCommit", vm.envOr("SOURCE_COMMIT", string("unknown")));
        string memory out = vm.envOr(
            "DEPLOYMENT_FILE", string.concat("deployments/", vm.toString(block.chainid), ".json")
        );
        vm.writeJson(json, out);
    }
}
