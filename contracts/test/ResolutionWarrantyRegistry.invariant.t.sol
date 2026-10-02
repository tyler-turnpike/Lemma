// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ResolutionWarrantyRegistry as R} from "../src/ResolutionWarrantyRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Drives the registry through random bounded sequences of valid-ish operations.
contract RegistryHandler is Test {
    R internal registry;
    MockUSDC internal usdc;
    address internal admin;

    uint256 internal constant PROVIDER_KEY = 0xA11CE;
    uint256 internal constant EVALUATOR_KEY = 0xE7A1;
    address internal provider;
    address internal evaluator;

    bytes32[] public releaseIds;
    address[] public buyers;
    bytes32[] public resolutionIds;
    uint256 internal nonce;

    // ghost counters
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawnBond;
    uint256 public ghostCreditsWithdrawn;
    uint256 public ghostFailedAmount;

    constructor(R registry_, MockUSDC usdc_, address admin_) {
        registry = registry_;
        usdc = usdc_;
        admin = admin_;
        provider = vm.addr(PROVIDER_KEY);
        evaluator = vm.addr(EVALUATOR_KEY);

        releaseIds.push(keccak256("rel-a@1"));
        releaseIds.push(keccak256("rel-b@1"));
        vm.startPrank(admin);
        registry.registerRelease(releaseIds[0], provider, evaluator, 120_000, 72 hours);
        registry.registerRelease(releaseIds[1], provider, evaluator, 2_500_000, 1 hours);
        vm.stopPrank();

        buyers.push(makeAddr("buyer-1"));
        buyers.push(makeAddr("buyer-2"));
        buyers.push(makeAddr("buyer-3"));
    }

    function releaseCount() external view returns (uint256) {
        return releaseIds.length;
    }

    function buyerCount() external view returns (uint256) {
        return buyers.length;
    }

    function deposit(uint256 releaseSeed, uint256 amount) external {
        bytes32 id = releaseIds[releaseSeed % releaseIds.length];
        if (!registry.getRelease(id).active || registry.paused()) return;
        amount = bound(amount, 1, 100_000_000);
        usdc.mint(provider, amount);
        vm.startPrank(provider);
        usdc.approve(address(registry), amount);
        registry.depositBond(id, amount);
        vm.stopPrank();
        ghostDeposited += amount;
    }

    function withdrawBond(uint256 releaseSeed, uint256 amount) external {
        bytes32 id = releaseIds[releaseSeed % releaseIds.length];
        uint256 available = registry.getRelease(id).availableBond;
        if (available == 0) return;
        amount = bound(amount, 1, available);
        vm.prank(provider);
        registry.withdrawUnreservedBond(id, amount);
        ghostWithdrawnBond += amount;
    }

    function activate(uint256 releaseSeed, uint256 buyerSeed) external {
        bytes32 id = releaseIds[releaseSeed % releaseIds.length];
        R.Release memory rel = registry.getRelease(id);
        if (!rel.active || registry.paused() || rel.availableBond < rel.price) return;
        address buyer = buyers[buyerSeed % buyers.length];
        nonce++;
        R.Voucher memory v = R.Voucher({
            resolutionId: keccak256(abi.encode("res", nonce)),
            releaseId: id,
            buyer: buyer,
            amount: rel.price,
            paymentHash: keccak256(abi.encode("pay", nonce)),
            payloadDigest: keccak256(abi.encode("payload", nonce)),
            expiresAt: uint64(block.timestamp + 10 minutes)
        });
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(PROVIDER_KEY, registry.hashVoucher(v));
        vm.prank(buyer);
        registry.activateResolution(v, abi.encodePacked(r, s, sv));
        resolutionIds.push(v.resolutionId);
    }

    function finalize(uint256 resSeed, bool passed) external {
        if (resolutionIds.length == 0) return;
        bytes32 resId = resolutionIds[resSeed % resolutionIds.length];
        R.Warranty memory w = registry.getWarranty(resId);
        if (w.status != R.WarrantyStatus.Active || block.timestamp > w.claimDeadline) return;
        R.Outcome memory o = R.Outcome({
            resolutionId: resId,
            result: passed ? 1 : 2,
            evidenceDigest: keccak256(abi.encode("ev", resId))
        });
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(EVALUATOR_KEY, registry.hashOutcome(o));
        registry.finalizeOutcome(o, abi.encodePacked(r, s, sv));
        if (!passed) ghostFailedAmount += w.amount;
    }

    function expire(uint256 resSeed) external {
        if (resolutionIds.length == 0) return;
        bytes32 resId = resolutionIds[resSeed % resolutionIds.length];
        R.Warranty memory w = registry.getWarranty(resId);
        if (w.status != R.WarrantyStatus.Active) return;
        if (block.timestamp <= w.claimDeadline) vm.warp(uint256(w.claimDeadline) + 1);
        registry.expireResolution(resId);
    }

    function withdrawCredit(uint256 buyerSeed) external {
        address buyer = buyers[buyerSeed % buyers.length];
        uint256 c = registry.credits(buyer);
        if (c == 0) return;
        vm.prank(buyer);
        registry.withdrawCredit();
        ghostCreditsWithdrawn += c;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 24 hours));
    }

    function togglePause(uint256 releaseSeed, bool deactivate) external {
        vm.startPrank(admin);
        // Deactivation is permanent, so keep it rare to keep the rest of the state machine live.
        if (deactivate && releaseSeed % 8 == 0) {
            bytes32 id = releaseIds[releaseSeed % releaseIds.length];
            if (registry.getRelease(id).active) registry.deactivateRelease(id);
        } else if (deactivate) {
            // no-op
        } else if (registry.paused()) {
            registry.unpause();
        } else {
            registry.pause();
        }
        vm.stopPrank();
    }
}

contract ResolutionWarrantyRegistryInvariantTest is StdInvariant, Test {
    R internal registry;
    MockUSDC internal usdc;
    RegistryHandler internal handler;

    function setUp() public {
        address admin = makeAddr("admin");
        usdc = new MockUSDC();
        registry = new R(usdc, admin);
        handler = new RegistryHandler(registry, usdc, admin);
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        vm.prank(admin);
        registry.grantRole(adminRole, address(handler));
        targetContract(address(handler));
    }

    /// USDC balance >= available + reserved + credits (here exact: no stray transfers).
    function invariant_balanceCoversLiabilities() public view {
        uint256 liabilities =
            registry.totalAvailableBond() + registry.totalReservedBond() + registry.totalCredits();
        assertGe(usdc.balanceOf(address(registry)), liabilities);
        assertEq(usdc.balanceOf(address(registry)), liabilities);
    }

    /// Storage totals equal the per-release / per-buyer sums.
    function invariant_totalsMatchSums() public view {
        uint256 available;
        uint256 reserved;
        for (uint256 i; i < handler.releaseCount(); i++) {
            R.Release memory r = registry.getRelease(handler.releaseIds(i));
            available += r.availableBond;
            reserved += r.reservedBond;
        }
        uint256 credits;
        for (uint256 i; i < handler.buyerCount(); i++) {
            credits += registry.credits(handler.buyers(i));
        }
        assertEq(registry.totalAvailableBond(), available);
        assertEq(registry.totalReservedBond(), reserved);
        assertEq(registry.totalCredits(), credits);
    }

    /// Flow conservation: deposits = withdrawn bond + refunded credits + money still held.
    function invariant_flowConservation() public view {
        assertEq(
            handler.ghostDeposited(),
            handler.ghostWithdrawnBond() + handler.ghostCreditsWithdrawn()
                + usdc.balanceOf(address(registry))
        );
        assertEq(
            handler.ghostFailedAmount(), handler.ghostCreditsWithdrawn() + registry.totalCredits()
        );
    }
}
