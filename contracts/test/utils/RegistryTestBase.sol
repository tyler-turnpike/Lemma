// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ResolutionWarrantyRegistry} from "../../src/ResolutionWarrantyRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

abstract contract RegistryTestBase is Test {
    ResolutionWarrantyRegistry internal registry;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal providerKey = 0xA11CE;
    uint256 internal evaluatorKey = 0xE7A1;
    uint256 internal otherKey = 0xBAD;
    address internal provider;
    address internal evaluator;

    bytes32 internal constant RELEASE_ID = keccak256("x402-mcp-server@1");
    uint256 internal constant PRICE = 120_000; // 0.12 USDC
    uint64 internal constant WINDOW = 72 hours;

    function setUp() public virtual {
        provider = vm.addr(providerKey);
        evaluator = vm.addr(evaluatorKey);
        usdc = new MockUSDC();
        registry = new ResolutionWarrantyRegistry(usdc, admin);
        vm.prank(admin);
        registry.registerRelease(RELEASE_ID, provider, evaluator, PRICE, WINDOW);
    }

    // ------------------------------------------------------------------ helpers

    function _deposit(uint256 amount) internal {
        usdc.mint(provider, amount);
        vm.startPrank(provider);
        usdc.approve(address(registry), amount);
        registry.depositBond(RELEASE_ID, amount);
        vm.stopPrank();
    }

    function _voucher(bytes32 resolutionId, bytes32 paymentHash)
        internal
        view
        returns (ResolutionWarrantyRegistry.Voucher memory v)
    {
        v = ResolutionWarrantyRegistry.Voucher({
            resolutionId: resolutionId,
            releaseId: RELEASE_ID,
            buyer: buyer,
            amount: PRICE,
            paymentHash: paymentHash,
            payloadDigest: keccak256(abi.encode("payload", resolutionId)),
            expiresAt: uint64(block.timestamp + 1 hours)
        });
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signVoucher(uint256 key, ResolutionWarrantyRegistry.Voucher memory v)
        internal
        view
        returns (bytes memory)
    {
        return _sign(key, registry.hashVoucher(v));
    }

    function _outcome(bytes32 resolutionId, uint8 result)
        internal
        pure
        returns (ResolutionWarrantyRegistry.Outcome memory)
    {
        return ResolutionWarrantyRegistry.Outcome({
            resolutionId: resolutionId,
            result: result,
            evidenceDigest: keccak256(abi.encode("evidence", resolutionId, result))
        });
    }

    function _signOutcome(uint256 key, ResolutionWarrantyRegistry.Outcome memory o)
        internal
        view
        returns (bytes memory)
    {
        return _sign(key, registry.hashOutcome(o));
    }

    function _activate(bytes32 resolutionId, bytes32 paymentHash)
        internal
        returns (ResolutionWarrantyRegistry.Voucher memory v)
    {
        v = _voucher(resolutionId, paymentHash);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function _finalize(bytes32 resolutionId, uint8 result) internal {
        ResolutionWarrantyRegistry.Outcome memory o = _outcome(resolutionId, result);
        registry.finalizeOutcome(o, _signOutcome(evaluatorKey, o));
    }

    function _assertAccounting() internal view {
        uint256 bal = usdc.balanceOf(address(registry));
        assertGe(
            bal,
            registry.totalAvailableBond() + registry.totalReservedBond() + registry.totalCredits(),
            "balance invariant"
        );
    }
}
