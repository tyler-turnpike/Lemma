// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ResolutionWarrantyRegistry as R} from "../src/ResolutionWarrantyRegistry.sol";
import {RegistryTestBase} from "./utils/RegistryTestBase.sol";

contract ResolutionWarrantyRegistryTest is RegistryTestBase {
    bytes32 internal constant RES_1 = keccak256("res-1");
    bytes32 internal constant RES_2 = keccak256("res-2");
    bytes32 internal constant PAY_1 = keccak256("pay-1");
    bytes32 internal constant PAY_2 = keccak256("pay-2");

    // =============================================================== constructor / roles

    function test_constructor_setsState() public view {
        assertEq(address(registry.usdc()), address(usdc));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(usdc.decimals(), 6);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(R.ZeroAddress.selector);
        new R(IERC20(address(0)), admin);
        vm.expectRevert(R.ZeroAddress.selector);
        new R(usdc, address(0));
    }

    // =============================================================== registerRelease

    function test_registerRelease_storesRelease() public view {
        R.Release memory r = registry.getRelease(RELEASE_ID);
        assertEq(r.provider, provider);
        assertEq(r.evaluator, evaluator);
        assertEq(r.price, PRICE);
        assertEq(r.claimWindow, WINDOW);
        assertTrue(r.registered);
        assertTrue(r.active);
        assertEq(r.availableBond, 0);
        assertEq(r.reservedBond, 0);
    }

    function test_registerRelease_emits() public {
        bytes32 id = keccak256("other@1");
        vm.expectEmit(address(registry));
        emit R.ReleaseRegistered(id, provider, evaluator, 5, 1 hours);
        vm.prank(admin);
        registry.registerRelease(id, provider, evaluator, 5, 1 hours);
    }

    function test_registerRelease_zeroWindowUsesDefault() public {
        bytes32 id = keccak256("other@1");
        vm.prank(admin);
        registry.registerRelease(id, provider, evaluator, PRICE, 0);
        assertEq(registry.getRelease(id).claimWindow, 72 hours);
    }

    function test_registerRelease_revertsForNonAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                registry.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        registry.registerRelease(keccak256("x"), provider, evaluator, PRICE, WINDOW);
    }

    function test_registerRelease_revertsOnDuplicate() public {
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseAlreadyRegistered.selector, RELEASE_ID));
        vm.prank(admin);
        registry.registerRelease(RELEASE_ID, provider, evaluator, PRICE, WINDOW);
    }

    function test_registerRelease_revertsOnBadParams() public {
        vm.startPrank(admin);
        vm.expectRevert(R.ZeroAddress.selector);
        registry.registerRelease(keccak256("a"), address(0), evaluator, PRICE, WINDOW);
        vm.expectRevert(R.ZeroAddress.selector);
        registry.registerRelease(keccak256("a"), provider, address(0), PRICE, WINDOW);
        vm.expectRevert(R.InvalidPrice.selector);
        registry.registerRelease(keccak256("a"), provider, evaluator, 0, WINDOW);
        vm.expectRevert(R.InvalidClaimWindow.selector);
        registry.registerRelease(keccak256("a"), provider, evaluator, PRICE, 30 days + 1);
        vm.stopPrank();
    }

    // =============================================================== depositBond

    function test_depositBond_movesUsdc() public {
        usdc.mint(provider, 1_000_000);
        vm.startPrank(provider);
        usdc.approve(address(registry), 1_000_000);
        vm.expectEmit(address(registry));
        emit R.BondDeposited(RELEASE_ID, provider, 1_000_000);
        registry.depositBond(RELEASE_ID, 1_000_000);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(registry)), 1_000_000);
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(registry.getRelease(RELEASE_ID).availableBond, 1_000_000);
        assertEq(registry.totalAvailableBond(), 1_000_000);
    }

    function test_depositBond_revertsForNonProvider() public {
        usdc.mint(stranger, 1);
        vm.startPrank(stranger);
        usdc.approve(address(registry), 1);
        vm.expectRevert(R.NotProvider.selector);
        registry.depositBond(RELEASE_ID, 1);
        vm.stopPrank();
    }

    function test_depositBond_revertsOnZero() public {
        vm.expectRevert(R.ZeroAmount.selector);
        vm.prank(provider);
        registry.depositBond(RELEASE_ID, 0);
    }

    function test_depositBond_revertsOnUnregistered() public {
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseNotRegistered.selector, bytes32("nope")));
        vm.prank(provider);
        registry.depositBond(bytes32("nope"), 1);
    }

    function test_depositBond_revertsWhenInactive() public {
        vm.prank(admin);
        registry.deactivateRelease(RELEASE_ID);
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseInactive.selector, RELEASE_ID));
        vm.prank(provider);
        registry.depositBond(RELEASE_ID, 1);
    }

    function test_depositBond_revertsWhenPaused() public {
        vm.prank(admin);
        registry.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(provider);
        registry.depositBond(RELEASE_ID, 1);
    }

    // =============================================================== withdrawUnreservedBond

    function test_withdrawUnreservedBond_happy() public {
        _deposit(500_000);
        vm.expectEmit(address(registry));
        emit R.BondWithdrawn(RELEASE_ID, provider, 200_000);
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, 200_000);
        assertEq(usdc.balanceOf(provider), 200_000);
        assertEq(registry.getRelease(RELEASE_ID).availableBond, 300_000);
        assertEq(registry.totalAvailableBond(), 300_000);
    }

    function test_withdrawUnreservedBond_revertsForNonProvider() public {
        _deposit(500_000);
        vm.expectRevert(R.NotProvider.selector);
        vm.prank(admin);
        registry.withdrawUnreservedBond(RELEASE_ID, 1);
    }

    function test_withdrawUnreservedBond_revertsOnZero() public {
        vm.expectRevert(R.ZeroAmount.selector);
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, 0);
    }

    function test_withdrawUnreservedBond_cannotTouchReserved() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        // available = PRICE, reserved = PRICE
        vm.expectRevert(
            abi.encodeWithSelector(R.InsufficientAvailableBond.selector, PRICE, PRICE + 1)
        );
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, PRICE + 1);

        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, PRICE);
        assertEq(registry.getRelease(RELEASE_ID).reservedBond, PRICE);
        assertEq(usdc.balanceOf(address(registry)), PRICE);

        vm.expectRevert(abi.encodeWithSelector(R.InsufficientAvailableBond.selector, 0, 1));
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, 1);
    }

    function test_withdrawUnreservedBond_worksWhenPausedAndDeactivated() public {
        _deposit(PRICE);
        vm.startPrank(admin);
        registry.deactivateRelease(RELEASE_ID);
        registry.pause();
        vm.stopPrank();
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, PRICE);
        assertEq(usdc.balanceOf(provider), PRICE);
    }

    // =============================================================== deactivateRelease

    function test_deactivateRelease_byAdmin() public {
        vm.expectEmit(address(registry));
        emit R.ReleaseDeactivated(RELEASE_ID, admin);
        vm.prank(admin);
        registry.deactivateRelease(RELEASE_ID);
        assertFalse(registry.getRelease(RELEASE_ID).active);
    }

    function test_deactivateRelease_byProvider() public {
        vm.prank(provider);
        registry.deactivateRelease(RELEASE_ID);
        assertFalse(registry.getRelease(RELEASE_ID).active);
    }

    function test_deactivateRelease_revertsForStranger() public {
        vm.expectRevert(R.NotAdminOrProvider.selector);
        vm.prank(stranger);
        registry.deactivateRelease(RELEASE_ID);
    }

    function test_deactivateRelease_revertsTwice() public {
        vm.startPrank(admin);
        registry.deactivateRelease(RELEASE_ID);
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseInactive.selector, RELEASE_ID));
        registry.deactivateRelease(RELEASE_ID);
        vm.stopPrank();
    }

    function test_deactivatedRelease_blocksNewActivation() public {
        _deposit(PRICE);
        vm.prank(provider);
        registry.deactivateRelease(RELEASE_ID);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseInactive.selector, RELEASE_ID));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_deactivatedRelease_stillFinalizesExistingWarranty() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        _activate(RES_2, PAY_2);
        vm.prank(admin);
        registry.deactivateRelease(RELEASE_ID);

        _finalize(RES_1, 2); // failure -> credit
        assertEq(registry.credits(buyer), PRICE);
        assertEq(uint8(registry.getWarranty(RES_1).status), uint8(R.WarrantyStatus.Failed));

        vm.warp(block.timestamp + WINDOW + 1);
        registry.expireResolution(RES_2);
        assertEq(uint8(registry.getWarranty(RES_2).status), uint8(R.WarrantyStatus.Expired));
        assertEq(registry.getRelease(RELEASE_ID).availableBond, PRICE);
        assertEq(registry.getRelease(RELEASE_ID).reservedBond, 0);

        vm.prank(buyer);
        registry.withdrawCredit();
        assertEq(usdc.balanceOf(buyer), PRICE);
        _assertAccounting();
    }

    // =============================================================== activateResolution

    function test_activate_happy() public {
        _deposit(PRICE * 3);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        uint64 deadline = uint64(block.timestamp) + WINDOW;

        vm.expectEmit(address(registry));
        emit R.ResolutionActivated(
            RES_1, RELEASE_ID, buyer, PRICE, PAY_1, v.payloadDigest, deadline
        );
        vm.prank(buyer);
        registry.activateResolution(v, sig);

        R.Release memory r = registry.getRelease(RELEASE_ID);
        assertEq(r.availableBond, PRICE * 2);
        assertEq(r.reservedBond, PRICE);
        assertEq(registry.totalAvailableBond(), PRICE * 2);
        assertEq(registry.totalReservedBond(), PRICE);
        assertTrue(registry.paymentHashUsed(PAY_1));

        R.Warranty memory w = registry.getWarranty(RES_1);
        assertEq(w.releaseId, RELEASE_ID);
        assertEq(w.buyer, buyer);
        assertEq(w.amount, PRICE);
        assertEq(w.claimDeadline, deadline);
        assertEq(uint8(w.status), uint8(R.WarrantyStatus.Active));
        assertEq(w.paymentHash, PAY_1);
        assertEq(w.payloadDigest, v.payloadDigest);
        _assertAccounting();
    }

    function test_activate_atExactExpiryIsAccepted() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.warp(v.expiresAt);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnExpiredVoucher() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.warp(uint256(v.expiresAt) + 1);
        vm.expectRevert(abi.encodeWithSelector(R.VoucherExpired.selector, v.expiresAt));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnReplayedResolutionId() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        R.Voucher memory v = _voucher(RES_1, PAY_2);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.ResolutionAlreadyUsed.selector, RES_1));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnReplayedResolutionIdAfterFinalize() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        _finalize(RES_1, 1);
        R.Voucher memory v = _voucher(RES_1, PAY_2);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.ResolutionAlreadyUsed.selector, RES_1));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnReplayedPaymentHash() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        R.Voucher memory v = _voucher(RES_2, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.PaymentHashAlreadyUsed.selector, PAY_1));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnWrongBuyer() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(R.CallerNotBuyer.selector);
        vm.prank(stranger);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsWhenBuyerFieldSwapped() public {
        // A stranger rewriting the buyer to itself invalidates the provider signature.
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        v.buyer = stranger;
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(stranger);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnWrongSigner() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(otherKey, v);
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsWhenEvaluatorSignsVoucher() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(evaluatorKey, v);
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnTamperedPayloadDigest() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        v.payloadDigest = keccak256("tampered");
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnMalformedSignature() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, hex"1234");
    }

    function test_activate_revertsOnSignatureForOtherChain() public {
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        uint256 chain = block.chainid;
        vm.chainId(1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.chainId(chain);
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnAmountNotPrice() public {
        _deposit(PRICE * 2);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        v.amount = PRICE + 1;
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.AmountMismatch.selector, PRICE, PRICE + 1));
        vm.prank(buyer);
        registry.activateResolution(v, sig);

        v.amount = PRICE - 1;
        sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.AmountMismatch.selector, PRICE, PRICE - 1));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnInsufficientBond() public {
        _deposit(PRICE - 1);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(
            abi.encodeWithSelector(R.InsufficientAvailableBond.selector, PRICE - 1, PRICE)
        );
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsWhenBondFullyReserved() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        R.Voucher memory v = _voucher(RES_2, PAY_2);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.InsufficientAvailableBond.selector, 0, PRICE));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsWhenPaused() public {
        _deposit(PRICE);
        vm.prank(admin);
        registry.pause();
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);

        vm.prank(admin);
        registry.unpause();
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function test_activate_revertsOnUnregisteredRelease() public {
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        v.releaseId = keccak256("unknown");
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.ReleaseNotRegistered.selector, v.releaseId));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    // =============================================================== finalizeOutcome

    function test_finalize_pass_releasesReservation() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        R.Outcome memory o = _outcome(RES_1, 1);
        bytes memory sig = _signOutcome(evaluatorKey, o);

        vm.expectEmit(address(registry));
        emit R.OutcomeFinalized(RES_1, RELEASE_ID, buyer, 1, PRICE, o.evidenceDigest);
        vm.prank(stranger); // anyone may submit
        registry.finalizeOutcome(o, sig);

        R.Release memory r = registry.getRelease(RELEASE_ID);
        assertEq(r.availableBond, PRICE);
        assertEq(r.reservedBond, 0);
        assertEq(registry.credits(buyer), 0);
        R.Warranty memory w = registry.getWarranty(RES_1);
        assertEq(uint8(w.status), uint8(R.WarrantyStatus.Passed));
        assertEq(w.evidenceDigest, o.evidenceDigest);
        _assertAccounting();
    }

    function test_finalize_fail_creditsBuyer_andWithdraw() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        _finalize(RES_1, 2);

        R.Release memory r = registry.getRelease(RELEASE_ID);
        assertEq(r.availableBond, 0);
        assertEq(r.reservedBond, 0);
        assertEq(registry.credits(buyer), PRICE);
        assertEq(registry.totalCredits(), PRICE);
        assertEq(uint8(registry.getWarranty(RES_1).status), uint8(R.WarrantyStatus.Failed));
        _assertAccounting();

        vm.expectEmit(address(registry));
        emit R.CreditWithdrawn(buyer, PRICE);
        vm.prank(buyer);
        registry.withdrawCredit();
        assertEq(usdc.balanceOf(buyer), PRICE);
        assertEq(registry.credits(buyer), 0);
        assertEq(registry.totalCredits(), 0);
        assertEq(usdc.balanceOf(address(registry)), 0);
    }

    function test_finalize_revertsOnWrongEvaluator() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        R.Outcome memory o = _outcome(RES_1, 2);
        bytes memory sig = _signOutcome(otherKey, o);
        vm.expectRevert(R.InvalidEvaluatorSignature.selector);
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_revertsWhenProviderSigns() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        R.Outcome memory o = _outcome(RES_1, 1);
        bytes memory sig = _signOutcome(providerKey, o);
        vm.expectRevert(R.InvalidEvaluatorSignature.selector);
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_revertsOnFlippedResult() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        R.Outcome memory o = _outcome(RES_1, 1);
        bytes memory sig = _signOutcome(evaluatorKey, o);
        o.result = 2;
        vm.expectRevert(R.InvalidEvaluatorSignature.selector);
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_revertsOnInvalidResult() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        for (uint8 res = 0; res < 5; res++) {
            if (res == 1 || res == 2) continue;
            R.Outcome memory o = _outcome(RES_1, res);
            bytes memory sig = _signOutcome(evaluatorKey, o);
            vm.expectRevert(abi.encodeWithSelector(R.InvalidResult.selector, res));
            registry.finalizeOutcome(o, sig);
        }
    }

    function test_finalize_atDeadlineIsAccepted() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        vm.warp(registry.getWarranty(RES_1).claimDeadline);
        _finalize(RES_1, 2);
        assertEq(registry.credits(buyer), PRICE);
    }

    function test_finalize_revertsAfterDeadline() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        uint64 deadline = registry.getWarranty(RES_1).claimDeadline;
        vm.warp(uint256(deadline) + 1);
        R.Outcome memory o = _outcome(RES_1, 2);
        bytes memory sig = _signOutcome(evaluatorKey, o);
        vm.expectRevert(abi.encodeWithSelector(R.ClaimWindowClosed.selector, deadline));
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_revertsTwice() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        _finalize(RES_1, 1);
        R.Outcome memory o = _outcome(RES_1, 2);
        bytes memory sig = _signOutcome(evaluatorKey, o);
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_revertsOnUnknownResolution() public {
        R.Outcome memory o = _outcome(RES_1, 1);
        bytes memory sig = _signOutcome(evaluatorKey, o);
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.finalizeOutcome(o, sig);
    }

    function test_finalize_worksWhilePaused() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        vm.prank(admin);
        registry.pause();
        _finalize(RES_1, 2);
        vm.prank(buyer);
        registry.withdrawCredit();
        assertEq(usdc.balanceOf(buyer), PRICE);
    }

    // =============================================================== expireResolution

    function test_expire_releasesReservation() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        vm.warp(uint256(registry.getWarranty(RES_1).claimDeadline) + 1);
        vm.expectEmit(address(registry));
        emit R.ResolutionExpired(RES_1, RELEASE_ID, PRICE);
        vm.prank(stranger);
        registry.expireResolution(RES_1);

        R.Release memory r = registry.getRelease(RELEASE_ID);
        assertEq(r.availableBond, PRICE);
        assertEq(r.reservedBond, 0);
        assertEq(uint8(registry.getWarranty(RES_1).status), uint8(R.WarrantyStatus.Expired));

        // Expired warranties can no longer be finalized or expired again.
        R.Outcome memory o = _outcome(RES_1, 2);
        bytes memory sig = _signOutcome(evaluatorKey, o);
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.finalizeOutcome(o, sig);
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.expireResolution(RES_1);

        // Provider can now withdraw the released bond.
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, PRICE);
        _assertAccounting();
    }

    function test_expire_revertsBeforeOrAtDeadline() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        uint64 deadline = registry.getWarranty(RES_1).claimDeadline;
        vm.expectRevert(abi.encodeWithSelector(R.ClaimWindowOpen.selector, deadline));
        registry.expireResolution(RES_1);
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(R.ClaimWindowOpen.selector, deadline));
        registry.expireResolution(RES_1);
    }

    function test_expire_revertsOnUnknownOrFinalized() public {
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.expireResolution(RES_1);

        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        _finalize(RES_1, 2);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(R.WarrantyNotActive.selector, RES_1));
        registry.expireResolution(RES_1);
    }

    function test_perReleaseClaimWindow() public {
        bytes32 id = keccak256("short@1");
        vm.prank(admin);
        registry.registerRelease(id, provider, evaluator, PRICE, 1 hours);
        usdc.mint(provider, PRICE);
        vm.startPrank(provider);
        usdc.approve(address(registry), PRICE);
        registry.depositBond(id, PRICE);
        vm.stopPrank();

        R.Voucher memory v = _voucher(RES_1, PAY_1);
        v.releaseId = id;
        bytes memory sig = _signVoucher(providerKey, v);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
        assertEq(registry.getWarranty(RES_1).claimDeadline, block.timestamp + 1 hours);
    }

    // =============================================================== withdrawCredit

    function test_withdrawCredit_revertsWithoutCredit() public {
        vm.expectRevert(R.NoCredit.selector);
        vm.prank(buyer);
        registry.withdrawCredit();
    }

    function test_withdrawCredit_accumulatesAcrossFailures() public {
        _deposit(PRICE * 2);
        _activate(RES_1, PAY_1);
        _activate(RES_2, PAY_2);
        _finalize(RES_1, 2);
        _finalize(RES_2, 2);
        assertEq(registry.credits(buyer), PRICE * 2);
        vm.prank(buyer);
        registry.withdrawCredit();
        assertEq(usdc.balanceOf(buyer), PRICE * 2);
        vm.expectRevert(R.NoCredit.selector);
        vm.prank(buyer);
        registry.withdrawCredit();
    }

    // =============================================================== pause

    function test_pause_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                provider,
                registry.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(provider);
        registry.pause();

        vm.prank(admin);
        registry.pause();
        assertTrue(registry.paused());

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                provider,
                registry.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(provider);
        registry.unpause();

        vm.prank(admin);
        registry.unpause();
        assertFalse(registry.paused());
    }

    function test_expire_worksWhilePaused() public {
        _deposit(PRICE);
        _activate(RES_1, PAY_1);
        vm.prank(admin);
        registry.pause();
        vm.warp(block.timestamp + WINDOW + 1);
        registry.expireResolution(RES_1);
    }

    // =============================================================== hashing

    function test_hashVoucher_matchesManualEip712() public view {
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes32 typeHash = keccak256(
            "ResolutionVoucher(bytes32 resolutionId,bytes32 releaseId,address buyer,uint256 amount,bytes32 paymentHash,bytes32 payloadDigest,uint64 expiresAt)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash,
                v.resolutionId,
                v.releaseId,
                v.buyer,
                v.amount,
                v.paymentHash,
                v.payloadDigest,
                v.expiresAt
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("LemmaWarrantyRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        assertEq(registry.VOUCHER_TYPEHASH(), typeHash);
        assertEq(registry.voucherStructHash(v), structHash);
        assertEq(registry.domainSeparator(), domain);
        assertEq(
            registry.hashVoucher(v), keccak256(abi.encodePacked("\x19\x01", domain, structHash))
        );
    }

    function test_hashOutcome_matchesManualEip712() public view {
        R.Outcome memory o = _outcome(RES_1, 2);
        bytes32 typeHash =
            keccak256("Outcome(bytes32 resolutionId,uint8 result,bytes32 evidenceDigest)");
        bytes32 structHash =
            keccak256(abi.encode(typeHash, o.resolutionId, o.result, o.evidenceDigest));
        assertEq(registry.OUTCOME_TYPEHASH(), typeHash);
        assertEq(registry.outcomeStructHash(o), structHash);
        assertEq(
            registry.hashOutcome(o),
            keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash))
        );
    }

    // =============================================================== fuzz

    function testFuzz_depositWithdraw(uint256 deposit, uint256 withdraw) public {
        deposit = bound(deposit, 1, 1e15); // up to 1B USDC (6 decimals)
        withdraw = bound(withdraw, 1, deposit);
        _deposit(deposit);
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, withdraw);
        assertEq(usdc.balanceOf(provider), withdraw);
        assertEq(registry.getRelease(RELEASE_ID).availableBond, deposit - withdraw);
        assertEq(usdc.balanceOf(address(registry)), deposit - withdraw);
        _assertAccounting();
    }

    function testFuzz_withdrawMoreThanAvailableReverts(uint256 deposit, uint256 extra) public {
        deposit = bound(deposit, 0, 1e15);
        extra = bound(extra, 1, 1e15);
        if (deposit > 0) _deposit(deposit);
        vm.expectRevert(
            abi.encodeWithSelector(R.InsufficientAvailableBond.selector, deposit, deposit + extra)
        );
        vm.prank(provider);
        registry.withdrawUnreservedBond(RELEASE_ID, deposit + extra);
    }

    function testFuzz_lifecycleConservesFunds(
        uint256 price,
        uint256 extraBond,
        uint8 path,
        uint64 window
    ) public {
        price = bound(price, 1, 1e13);
        extraBond = bound(extraBond, 0, 1e13);
        window = uint64(bound(window, 1, 30 days));
        path = uint8(bound(path, 0, 2)); // 0 pass, 1 fail, 2 expire

        bytes32 id = keccak256(abi.encode("fuzz", price));
        vm.prank(admin);
        registry.registerRelease(id, provider, evaluator, price, window);
        usdc.mint(provider, price + extraBond);
        vm.startPrank(provider);
        usdc.approve(address(registry), price + extraBond);
        registry.depositBond(id, price + extraBond);
        vm.stopPrank();

        R.Voucher memory v = _voucher(RES_1, PAY_1);
        v.releaseId = id;
        v.amount = price;
        bytes memory sig = _signVoucher(providerKey, v);
        vm.prank(buyer);
        registry.activateResolution(v, sig);

        // Reserved bond is never withdrawable.
        vm.expectRevert(
            abi.encodeWithSelector(R.InsufficientAvailableBond.selector, extraBond, extraBond + 1)
        );
        vm.prank(provider);
        registry.withdrawUnreservedBond(id, extraBond + 1);
        _assertAccounting();

        if (path == 0) {
            _finalize(RES_1, 1);
        } else if (path == 1) {
            _finalize(RES_1, 2);
        } else {
            vm.warp(block.timestamp + uint256(window) + 1);
            registry.expireResolution(RES_1);
        }
        _assertAccounting();

        uint256 refunded = path == 1 ? price : 0;
        if (refunded > 0) {
            vm.prank(buyer);
            registry.withdrawCredit();
        }
        uint256 available = registry.getRelease(id).availableBond;
        assertEq(available, price + extraBond - refunded);
        if (available > 0) {
            vm.prank(provider);
            registry.withdrawUnreservedBond(id, available);
        }
        assertEq(usdc.balanceOf(buyer), refunded);
        assertEq(usdc.balanceOf(provider), price + extraBond - refunded);
        assertEq(usdc.balanceOf(address(registry)), 0);
        assertEq(registry.totalAvailableBond(), 0);
        assertEq(registry.totalReservedBond(), 0);
        assertEq(registry.totalCredits(), 0);
    }

    function testFuzz_activateRejectsNonPriceAmount(uint256 amount) public {
        vm.assume(amount != PRICE);
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        v.amount = amount;
        bytes memory sig = _signVoucher(providerKey, v);
        vm.expectRevert(abi.encodeWithSelector(R.AmountMismatch.selector, PRICE, amount));
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }

    function testFuzz_activateRejectsForeignSigner(uint256 key) public {
        key = bound(
            key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336
        );
        vm.assume(key != providerKey);
        _deposit(PRICE);
        R.Voucher memory v = _voucher(RES_1, PAY_1);
        bytes memory sig = _signVoucher(key, v);
        vm.expectRevert(R.InvalidProviderSignature.selector);
        vm.prank(buyer);
        registry.activateResolution(v, sig);
    }
}
