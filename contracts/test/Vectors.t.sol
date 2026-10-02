// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {ResolutionWarrantyRegistry as R} from "../src/ResolutionWarrantyRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Fixed cross-language test vectors. See test/vectors.md. If any constant here changes,
///         the TypeScript signer must change too.
contract VectorsTest is Test {
    uint256 internal constant CHAIN_ID = 421614; // Arbitrum Sepolia
    // Deployer key 1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf; registry is its nonce-0 CREATE.
    uint256 internal constant DEPLOYER_KEY = 1;
    address internal constant EXPECTED_REGISTRY = 0xF2E246BB76DF876Cef8b38ae84130F4F55De395b;
    // Provider signing key used for the signature vector (test only, never use on a real chain).
    uint256 internal constant PROVIDER_KEY = 0xA11CE;

    bytes32 internal constant EXPECTED_VOUCHER_TYPEHASH =
        0xea72b9a58c0c2844af1fcc61526e73eb73abd4350774ae0058e2a7bba4c61c37;
    bytes32 internal constant EXPECTED_VOUCHER_STRUCT_HASH =
        0x58720dd088a3c544504c27a7818e9874ea98a19bc1a92ed51b311e4e13f06b53;
    bytes32 internal constant EXPECTED_DOMAIN_SEPARATOR =
        0xef868167cc691b7baf5196e6dbbdd43ffb1034fc912452de233fc8aae50f2484;
    bytes32 internal constant EXPECTED_VOUCHER_DIGEST =
        0x3c5554bb185834a5ae90a4c34237e9a21f44e1de520c2e3115539a6948b8e825;
    bytes32 internal constant EXPECTED_OUTCOME_STRUCT_HASH =
        0xf1d0c01c77862dbe67893c96282aced365e6326a23d38ced288f4437cbc7d706;
    bytes32 internal constant EXPECTED_OUTCOME_DIGEST =
        0x4b83930dab97ae19506a8f347fd192e763520a81d3ba3d361c02e42645079f78;
    bytes internal constant EXPECTED_PROVIDER_SIG =
        hex"ab1d5504510dafe029e7402569e386a73c3eebd1acbeca109a0ad3dd3246b04a131c831d89ba4a0ee48aa9847673b744747b466bb7c5d7a27927d39f30e49c001c";

    function _voucher() internal pure returns (R.Voucher memory) {
        return R.Voucher({
            resolutionId: keccak256("res-1"),
            releaseId: keccak256("x402-mcp-server@1"),
            buyer: 0x000000000000000000000000000000000000bEEF,
            amount: 120000,
            paymentHash: keccak256("pay-1"),
            payloadDigest: keccak256("payload-1"),
            expiresAt: 2000000000
        });
    }

    function _outcome() internal pure returns (R.Outcome memory) {
        return R.Outcome({
            resolutionId: keccak256("res-1"), result: 2, evidenceDigest: keccak256("evidence-1")
        });
    }

    function test_vector_voucher() public {
        vm.chainId(CHAIN_ID);
        address deployer = vm.addr(DEPLOYER_KEY);
        // Use a USDC mock deployed from a different account so the deployer stays at nonce 0.
        MockUSDC usdc = new MockUSDC();
        vm.setNonce(deployer, 0);
        vm.prank(deployer);
        R registry = new R(usdc, deployer);
        assertEq(address(registry), vm.computeCreateAddress(deployer, 0));

        R.Voucher memory v = _voucher();
        bytes32 structHash = registry.voucherStructHash(v);
        bytes32 digest = registry.hashVoucher(v);
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(PROVIDER_KEY, digest);

        R.Outcome memory o = _outcome();

        console2.log("deployer", deployer);
        console2.log("registry", address(registry));
        console2.log("provider", vm.addr(PROVIDER_KEY));
        console2.log("VOUCHER_TYPEHASH");
        console2.logBytes32(registry.VOUCHER_TYPEHASH());
        console2.log("OUTCOME_TYPEHASH");
        console2.logBytes32(registry.OUTCOME_TYPEHASH());
        console2.log("voucher.resolutionId");
        console2.logBytes32(v.resolutionId);
        console2.log("voucher.releaseId");
        console2.logBytes32(v.releaseId);
        console2.log("voucher.paymentHash");
        console2.logBytes32(v.paymentHash);
        console2.log("voucher.payloadDigest");
        console2.logBytes32(v.payloadDigest);
        console2.log("voucher structHash");
        console2.logBytes32(structHash);
        console2.log("domainSeparator");
        console2.logBytes32(registry.domainSeparator());
        console2.log("voucher digest");
        console2.logBytes32(digest);
        console2.log("provider signature (r,s,v)");
        console2.logBytes(abi.encodePacked(r, s, sv));
        console2.log("outcome.evidenceDigest");
        console2.logBytes32(o.evidenceDigest);
        console2.log("outcome structHash");
        console2.logBytes32(registry.outcomeStructHash(o));
        console2.log("outcome digest");
        console2.logBytes32(registry.hashOutcome(o));

        assertEq(address(registry), EXPECTED_REGISTRY);
        assertEq(registry.VOUCHER_TYPEHASH(), EXPECTED_VOUCHER_TYPEHASH);
        assertEq(structHash, EXPECTED_VOUCHER_STRUCT_HASH);
        assertEq(registry.domainSeparator(), EXPECTED_DOMAIN_SEPARATOR);
        assertEq(digest, EXPECTED_VOUCHER_DIGEST);
        assertEq(abi.encodePacked(r, s, sv), EXPECTED_PROVIDER_SIG);
        assertEq(registry.outcomeStructHash(o), EXPECTED_OUTCOME_STRUCT_HASH);
        assertEq(registry.hashOutcome(o), EXPECTED_OUTCOME_DIGEST);
    }
}
