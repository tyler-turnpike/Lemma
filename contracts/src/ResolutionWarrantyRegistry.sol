// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ResolutionWarrantyRegistry
/// @notice Holds provider USDC bonds for Lemma Capability Releases. A provider-signed Resolution
///         Voucher reserves bond equal to the resolution price; an evaluator-signed Outcome either
///         releases the reservation (pass) or converts it into buyer withdrawal credit (failure).
///         Unresolved reservations are released after the claim window expires.
/// @dev    MVP trust model: the admin registers releases, the registered evaluator is trusted for
///         pass/fail attestations. x402 remains the payment rail; this contract only provides bounded
///         recourse after payment. Amounts are six-decimal atomic USDC units.
///         Accounting invariant: usdc.balanceOf(this) >= totalAvailableBond + totalReservedBond
///         + totalCredits.
contract ResolutionWarrantyRegistry is AccessControl, EIP712, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    struct Voucher {
        bytes32 resolutionId;
        bytes32 releaseId;
        address buyer;
        uint256 amount;
        bytes32 paymentHash;
        bytes32 payloadDigest;
        uint64 expiresAt;
    }

    struct Outcome {
        bytes32 resolutionId;
        uint8 result; // 1 = Passed, 2 = Failed
        bytes32 evidenceDigest;
    }

    struct Release {
        address provider; // bond owner and voucher signer
        address evaluator; // outcome signer
        uint256 price; // six-decimal USDC
        uint64 claimWindow; // seconds
        bool registered;
        bool active;
        uint256 availableBond;
        uint256 reservedBond;
    }

    enum WarrantyStatus {
        None,
        Active,
        Passed,
        Failed,
        Expired
    }

    struct Warranty {
        bytes32 releaseId;
        address buyer;
        uint256 amount;
        uint64 claimDeadline;
        WarrantyStatus status;
        bytes32 paymentHash;
        bytes32 payloadDigest;
        bytes32 evidenceDigest;
    }

    // ---------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "ResolutionVoucher(bytes32 resolutionId,bytes32 releaseId,address buyer,uint256 amount,bytes32 paymentHash,bytes32 payloadDigest,uint64 expiresAt)"
    );

    bytes32 public constant OUTCOME_TYPEHASH =
        keccak256("Outcome(bytes32 resolutionId,uint8 result,bytes32 evidenceDigest)");

    uint8 public constant RESULT_PASSED = 1;
    uint8 public constant RESULT_FAILED = 2;

    uint64 public constant DEFAULT_CLAIM_WINDOW = 72 hours;
    uint64 public constant MAX_CLAIM_WINDOW = 30 days;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    IERC20 public immutable usdc;

    mapping(bytes32 releaseId => Release) private _releases;
    mapping(bytes32 resolutionId => Warranty) private _warranties;
    mapping(bytes32 paymentHash => bool) public paymentHashUsed;
    mapping(address buyer => uint256) public credits;

    uint256 public totalAvailableBond;
    uint256 public totalReservedBond;
    uint256 public totalCredits;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event ReleaseRegistered(
        bytes32 indexed releaseId,
        address indexed provider,
        address indexed evaluator,
        uint256 price,
        uint64 claimWindow
    );
    event ReleaseDeactivated(bytes32 indexed releaseId, address indexed by);
    event BondDeposited(bytes32 indexed releaseId, address indexed provider, uint256 amount);
    event BondWithdrawn(bytes32 indexed releaseId, address indexed provider, uint256 amount);
    event ResolutionActivated(
        bytes32 indexed resolutionId,
        bytes32 indexed releaseId,
        address indexed buyer,
        uint256 amount,
        bytes32 paymentHash,
        bytes32 payloadDigest,
        uint64 claimDeadline
    );
    event OutcomeFinalized(
        bytes32 indexed resolutionId,
        bytes32 indexed releaseId,
        address indexed buyer,
        uint8 result,
        uint256 amount,
        bytes32 evidenceDigest
    );
    event ResolutionExpired(
        bytes32 indexed resolutionId, bytes32 indexed releaseId, uint256 amount
    );
    event CreditWithdrawn(address indexed buyer, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error InvalidPrice();
    error InvalidClaimWindow();
    error ReleaseAlreadyRegistered(bytes32 releaseId);
    error ReleaseNotRegistered(bytes32 releaseId);
    error ReleaseInactive(bytes32 releaseId);
    error NotProvider();
    error NotAdminOrProvider();
    error InsufficientAvailableBond(uint256 available, uint256 requested);
    error CallerNotBuyer();
    error VoucherExpired(uint64 expiresAt);
    error InvalidProviderSignature();
    error AmountMismatch(uint256 expected, uint256 actual);
    error ResolutionAlreadyUsed(bytes32 resolutionId);
    error PaymentHashAlreadyUsed(bytes32 paymentHash);
    error InvalidResult(uint8 result);
    error WarrantyNotActive(bytes32 resolutionId);
    error ClaimWindowClosed(uint64 claimDeadline);
    error ClaimWindowOpen(uint64 claimDeadline);
    error InvalidEvaluatorSignature();
    error NoCredit();

    // ---------------------------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------------------------

    constructor(IERC20 usdc_, address admin) EIP712("LemmaWarrantyRegistry", "1") {
        if (address(usdc_) == address(0) || admin == address(0)) revert ZeroAddress();
        usdc = usdc_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice Register a versioned Capability Release. A zero claimWindow uses the 72h default.
    function registerRelease(
        bytes32 releaseId,
        address provider,
        address evaluator,
        uint256 price,
        uint64 claimWindow
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (provider == address(0) || evaluator == address(0)) revert ZeroAddress();
        if (price == 0) revert InvalidPrice();
        if (claimWindow == 0) claimWindow = DEFAULT_CLAIM_WINDOW;
        if (claimWindow > MAX_CLAIM_WINDOW) revert InvalidClaimWindow();
        Release storage r = _releases[releaseId];
        if (r.registered) revert ReleaseAlreadyRegistered(releaseId);

        r.provider = provider;
        r.evaluator = evaluator;
        r.price = price;
        r.claimWindow = claimWindow;
        r.registered = true;
        r.active = true;

        emit ReleaseRegistered(releaseId, provider, evaluator, price, claimWindow);
    }

    /// @notice Stop new activations for a release. Existing warranties remain finalizable/expirable.
    function deactivateRelease(bytes32 releaseId) external {
        Release storage r = _registered(releaseId);
        if (msg.sender != r.provider && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAdminOrProvider();
        }
        if (!r.active) revert ReleaseInactive(releaseId);
        r.active = false;
        emit ReleaseDeactivated(releaseId, msg.sender);
    }

    /// @notice Pause new bond deposits and new warranty activations. Outcomes, expiry and
    ///         withdrawals stay available so funds are never locked by a pause.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------------------------------
    // Provider bond
    // ---------------------------------------------------------------------------------------------

    function depositBond(bytes32 releaseId, uint256 amount) external whenNotPaused nonReentrant {
        Release storage r = _registered(releaseId);
        if (msg.sender != r.provider) revert NotProvider();
        if (!r.active) revert ReleaseInactive(releaseId);
        if (amount == 0) revert ZeroAmount();

        r.availableBond += amount;
        totalAvailableBond += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit BondDeposited(releaseId, msg.sender, amount);
    }

    /// @notice Withdraw bond that is not reserved by an active warranty.
    function withdrawUnreservedBond(bytes32 releaseId, uint256 amount) external nonReentrant {
        Release storage r = _registered(releaseId);
        if (msg.sender != r.provider) revert NotProvider();
        if (amount == 0) revert ZeroAmount();
        if (amount > r.availableBond) revert InsufficientAvailableBond(r.availableBond, amount);

        r.availableBond -= amount;
        totalAvailableBond -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit BondWithdrawn(releaseId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Warranty lifecycle
    // ---------------------------------------------------------------------------------------------

    /// @notice Activate a provider-signed voucher, reserving bond equal to the resolution price.
    /// @dev    The buyer (or the bridge acting as the buyer key) must submit.
    function activateResolution(Voucher calldata v, bytes calldata providerSig)
        external
        whenNotPaused
    {
        if (msg.sender != v.buyer) revert CallerNotBuyer();
        if (block.timestamp > v.expiresAt) revert VoucherExpired(v.expiresAt);

        Release storage r = _registered(v.releaseId);
        if (!r.active) revert ReleaseInactive(v.releaseId);
        if (v.amount != r.price) revert AmountMismatch(r.price, v.amount);
        if (_warranties[v.resolutionId].status != WarrantyStatus.None) {
            revert ResolutionAlreadyUsed(v.resolutionId);
        }
        if (paymentHashUsed[v.paymentHash]) revert PaymentHashAlreadyUsed(v.paymentHash);
        if (!_isSigner(r.provider, hashVoucher(v), providerSig)) revert InvalidProviderSignature();
        if (r.availableBond < v.amount) {
            revert InsufficientAvailableBond(r.availableBond, v.amount);
        }

        r.availableBond -= v.amount;
        r.reservedBond += v.amount;
        totalAvailableBond -= v.amount;
        totalReservedBond += v.amount;
        paymentHashUsed[v.paymentHash] = true;

        uint64 claimDeadline = uint64(block.timestamp) + r.claimWindow;
        _warranties[v.resolutionId] = Warranty({
            releaseId: v.releaseId,
            buyer: v.buyer,
            amount: v.amount,
            claimDeadline: claimDeadline,
            status: WarrantyStatus.Active,
            paymentHash: v.paymentHash,
            payloadDigest: v.payloadDigest,
            evidenceDigest: bytes32(0)
        });

        emit ResolutionActivated(
            v.resolutionId,
            v.releaseId,
            v.buyer,
            v.amount,
            v.paymentHash,
            v.payloadDigest,
            claimDeadline
        );
    }

    /// @notice Finalize an evaluator-signed pass/fail outcome within the claim window. Anyone may
    ///         submit; authority comes from the evaluator signature.
    function finalizeOutcome(Outcome calldata o, bytes calldata evaluatorSig) external {
        if (o.result != RESULT_PASSED && o.result != RESULT_FAILED) revert InvalidResult(o.result);
        Warranty storage w = _warranties[o.resolutionId];
        if (w.status != WarrantyStatus.Active) revert WarrantyNotActive(o.resolutionId);
        if (block.timestamp > w.claimDeadline) revert ClaimWindowClosed(w.claimDeadline);

        Release storage r = _releases[w.releaseId];
        if (!_isSigner(r.evaluator, hashOutcome(o), evaluatorSig)) {
            revert InvalidEvaluatorSignature();
        }

        uint256 amount = w.amount;
        r.reservedBond -= amount;
        totalReservedBond -= amount;
        w.evidenceDigest = o.evidenceDigest;

        if (o.result == RESULT_PASSED) {
            w.status = WarrantyStatus.Passed;
            r.availableBond += amount;
            totalAvailableBond += amount;
        } else {
            w.status = WarrantyStatus.Failed;
            credits[w.buyer] += amount;
            totalCredits += amount;
        }

        emit OutcomeFinalized(
            o.resolutionId, w.releaseId, w.buyer, o.result, amount, o.evidenceDigest
        );
    }

    /// @notice Release the reservation of an unresolved warranty after its claim deadline.
    function expireResolution(bytes32 resolutionId) external {
        Warranty storage w = _warranties[resolutionId];
        if (w.status != WarrantyStatus.Active) revert WarrantyNotActive(resolutionId);
        if (block.timestamp <= w.claimDeadline) revert ClaimWindowOpen(w.claimDeadline);

        Release storage r = _releases[w.releaseId];
        uint256 amount = w.amount;
        w.status = WarrantyStatus.Expired;
        r.reservedBond -= amount;
        r.availableBond += amount;
        totalReservedBond -= amount;
        totalAvailableBond += amount;

        emit ResolutionExpired(resolutionId, w.releaseId, amount);
    }

    /// @notice Pull the caller's full refund credit.
    function withdrawCredit() external nonReentrant {
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        credits[msg.sender] = 0;
        totalCredits -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CreditWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Views and hashing helpers
    // ---------------------------------------------------------------------------------------------

    function getRelease(bytes32 releaseId) external view returns (Release memory) {
        return _releases[releaseId];
    }

    function getWarranty(bytes32 resolutionId) external view returns (Warranty memory) {
        return _warranties[resolutionId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-712 struct hash of a voucher (domain independent).
    function voucherStructHash(Voucher calldata v) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VOUCHER_TYPEHASH,
                v.resolutionId,
                v.releaseId,
                v.buyer,
                v.amount,
                v.paymentHash,
                v.payloadDigest,
                v.expiresAt
            )
        );
    }

    /// @notice EIP-712 struct hash of an outcome (domain independent).
    function outcomeStructHash(Outcome calldata o) public pure returns (bytes32) {
        return keccak256(abi.encode(OUTCOME_TYPEHASH, o.resolutionId, o.result, o.evidenceDigest));
    }

    /// @notice Full EIP-712 digest the provider signs for a voucher.
    function hashVoucher(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(voucherStructHash(v));
    }

    /// @notice Full EIP-712 digest the evaluator signs for an outcome.
    function hashOutcome(Outcome calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(outcomeStructHash(o));
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    /// @dev EOA-only ECDSA check (65-byte r,s,v signatures; OZ rejects high-s malleable forms).
    ///      SignatureChecker/ERC-1271 is intentionally not used: OZ's implementation requires the
    ///      Cancun MCOPY opcode while this project compiles for Shanghai.
    function _isSigner(address expected, bytes32 digest, bytes calldata sig)
        private
        pure
        returns (bool)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
    }

    function _registered(bytes32 releaseId) private view returns (Release storage r) {
        r = _releases[releaseId];
        if (!r.registered) revert ReleaseNotRegistered(releaseId);
    }
}
