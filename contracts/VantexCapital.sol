// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VantexCapital
 * @notice Stablecoin investment and referral accounting based on the supplied Vantex plan.
 * @dev Rates use basis points (100 = 1%). ROI packages release equal daily profit and capital and
 *      stop at 2x. Compound packages pay continuously accrued profit at 0.60%/0.65%/0.70% for
 *      90/150/200 earning days; profit is claimable anytime and principal unlocks at maturity.
 *      Earnings accrue Monday through Friday in UTC. This is a pooled-reward contract:
 *      the owner must keep it solvent and no return is guaranteed by the code.
 */
contract VantexCapital is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    uint16 private constant BPS = 10_000;
    uint16 private constant MAX_PAYOUT_BPS = 20_000;
    uint16 private constant MAX_POSITIONS = 300;
    uint32 private constant DAY = 1 days;
    uint32 private constant SALARY_CYCLE = 15 days;
    uint8 private constant MAX_REFERRAL_LEVEL = 15;
    /// @notice Smallest ROI claim to the wallet, in whole USDT. Compounding is not affected.
    uint256 public constant MIN_CLAIM_USD = 5;

    /// @dev Package1-4 are live deposit packages. The final three values are retained only so an
    ///      upgrade can still decode positions created by the previous compounding implementation.
    enum Plan { Package1, Package2, Package3, Package4, Starter, Growth, Elite }
    enum Leg { A, B }
    /// @dev Retained in the ABI and member storage for upgrade compatibility. Qualification now
    ///      always requires equal business in Organizations A and B, regardless of this value.
    enum Split { A60B40, A40B60 }
    enum RewardMode { ROI, AutoCompound }

    struct Position {
        uint128 principal;
        uint128 claimed;
        uint40 startedAt;
        uint40 endsAt;
        uint16 dailyRateBps;
        Plan plan;
    }

    struct PermitSignature {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice One ROI-on-ROI payment: when it was paid, from which level and how much.
    struct ReferralPayment {
        uint128 amount;
        uint40 paidAt;
        uint8 level;
        address source;
    }

    /// @notice Running ROI-on-ROI totals for one level of a member's team.
    struct LevelEarnings {
        uint128 total;
        uint40 lastPaidAt;
        uint32 payments;
    }

    /// @notice Live payout details for one position, calculated with the same rules used by claimRoi.
    struct PositionRoiDetails {
        uint256 accruedPayout;
        uint256 claimedPayout;
        uint256 claimablePayout;
        uint256 profitAccrued;
        uint256 capitalReturned;
        uint256 maximumPayout;
        bool active;
    }

    struct Member {
        address referrer;
        uint128 personalBusiness;
        uint128 legABusiness;
        uint128 legBBusiness;
        uint40 salaryStartedAt;
        uint8 salaryRank;
        uint8 salaryClaims;
        Split split;
        bool registered;
    }

    IERC20 public paymentToken;
    uint8 public tokenDecimals;
    uint256 public unit;
    bool public paused;

    mapping(address => Member) public members;
    mapping(address => Position[]) private _positions;
    mapping(address => mapping(Leg => address)) public directLeg;
    mapping(address => uint256) public referralEarnings;

    uint16[15] public referralRateBps;
    /// @notice Additional balanced-business block for each level group: 1-3, 4-7, 8-11, 12-15.
    ///         Cumulative unlock totals are therefore $100, $400, $1,200 and $2,700.
    uint16[4] public levelBusinessUsd;
    uint32[5] public salaryBusinessUsd;
    uint16[5] public salaryAmountUsd;

    uint256 public totalDeposited;
    uint256 public totalCompounded;
    uint256 public totalRewardsPaid;

    mapping(address => RewardMode) public rewardMode;
    mapping(address => uint256) public lastAutoCompoundDay;

    /// @notice The member whose invite link or wallet address the account joined with. After
    ///         spillover this can differ from `members[account].referrer`, the placement parent.
    mapping(address => address) public sponsorOf;
    mapping(address => address[]) private _directReferrals;

    /// @dev ROI-on-ROI history, recorded from the upgrade that added it onwards.
    mapping(address => ReferralPayment[]) private _referralPayments;
    mapping(address => LevelEarnings[15]) private _levelEarnings;

    /// @dev Growth moved out of a virtual balance during a claim or mode change. It remains here
    ///      until the wallet transfer succeeds, so reverting a below-minimum claim loses nothing.
    mapping(address => uint256) private _autoCarry;

    /// @dev Retained for storage compatibility with the previous separate-position compound model.
    mapping(address => mapping(uint256 => uint256)) public lotOffset;

    /// @notice Original deposited principal for each position. Auto Compound grows the position's
    ///         displayed principal above this baseline and resets to this value after a claim.
    /// @dev Appended after the legacy auto-compound fields to preserve upgradeable storage layout.
    mapping(address => mapping(uint256 => uint256)) public originalPrincipal;

    error Paused();
    error InvalidAmount();
    error InvalidReferrer();
    error AlreadyRegistered();
    error LegOccupied();
    error TooManyPositions();
    error NothingToClaim();
    error BelowMinimumClaim(uint256 minimum);
    error Insolvent();
    error TransferRestricted();
    error AutoCompoundDisabled();
    error OutsideEarningDay();
    error AlreadyProcessed();
    error InvalidSponsor();

    event Registered(address indexed member, address indexed referrer, Leg leg, Split split);
    event Invested(address indexed member, uint256 indexed positionId, uint256 amount, Plan plan, uint16 dailyRateBps, uint40 endsAt);
    event RoiClaimed(address indexed member, uint256 amount);
    event RoiCompounded(address indexed member, uint256 indexed positionId, uint256 amount, Plan plan);
    event ReferralPaid(address indexed earner, address indexed source, uint8 level, uint256 amount);
    event SalaryActivated(address indexed member, uint8 rank, uint256 businessVolume);
    event SalaryClaimed(address indexed member, uint8 rank, uint8 cycle, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount);
    event PauseSet(bool paused);
    event Sponsored(address indexed member, address indexed sponsor);
    event RewardModeSet(address indexed member, RewardMode mode);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IERC20 token_, uint8 tokenDecimals_, address owner_) public initializer {
        if (address(token_) == address(0) || owner_ == address(0) || tokenDecimals_ > 18) revert InvalidAmount();
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        paymentToken = token_;
        tokenDecimals = tokenDecimals_;
        unit = 10 ** tokenDecimals_;
        referralRateBps = [uint16(1000), 500, 400, 300, 300, 300, 200, 200, 100, 100, 200, 200, 300, 400, 500];
        levelBusinessUsd = [uint16(100), 300, 800, 1500];
        salaryBusinessUsd = [uint32(1000), 2000, 5000, 10000, 20000];
        salaryAmountUsd = [uint16(25), 50, 125, 250, 500];
        members[owner_].registered = true;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    function register(address referrer, Leg leg, Split split) external whenNotPaused {
        _register(msg.sender, referrer, referrer, leg, split, RewardMode.ROI);
    }

    function registerWithMode(address referrer, Leg leg, Split split, RewardMode mode) external whenNotPaused {
        _register(msg.sender, referrer, referrer, leg, split, mode);
    }

    function invest(uint256 amount, Plan plan) external nonReentrant whenNotPaused {
        _invest(msg.sender, amount, plan);
    }

    function investWithPermit(
        uint256 amount,
        Plan plan,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _invest(msg.sender, amount, plan);
    }

    function registerAndInvestWithPermit(
        address referrer,
        Leg leg,
        Split split,
        uint256 amount,
        Plan plan,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        _register(msg.sender, referrer, referrer, leg, split, RewardMode.ROI);
        IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _invest(msg.sender, amount, plan);
    }

    function registerAndInvestWithPermitAndMode(
        address referrer,
        Leg leg,
        Split split,
        RewardMode mode,
        uint256 amount,
        Plan plan,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        _register(msg.sender, referrer, referrer, leg, split, mode);
        IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _invest(msg.sender, amount, plan);
    }

    /**
     * @notice Registers under `referrer` (the placement parent) while crediting `sponsor`, the
     *         member whose invite was used. Pass address(0) as sponsor to credit the referrer.
     *         The sponsor must be the referrer or one of its uplines (spillover stays in their team).
     */
    function registerWithSponsor(address sponsor, address referrer, Leg leg, Split split, RewardMode mode)
        external
        whenNotPaused
    {
        _register(msg.sender, sponsor, referrer, leg, split, mode);
    }

    function registerAndInvestWithSponsor(
        address sponsor,
        address referrer,
        Leg leg,
        Split split,
        RewardMode mode,
        uint256 amount,
        Plan plan,
        PermitSignature calldata permit
    ) external nonReentrant whenNotPaused {
        _register(msg.sender, sponsor, referrer, leg, split, mode);
        IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), amount, permit.deadline, permit.v, permit.r, permit.s);
        _invest(msg.sender, amount, plan);
    }

    /// @notice How many members joined with `account`'s invite (link or wallet address).
    function directReferralCount(address account) external view returns (uint256) {
        return _directReferrals[account].length;
    }

    /// @notice A page of the members who joined with `account`'s invite, in joining order.
    function directReferralsOf(address account, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        address[] storage list = _directReferrals[account];
        if (offset >= list.length) return new address[](0);
        uint256 end = offset + limit > list.length ? list.length : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) page[i - offset] = list[i];
    }

    /// @notice ROI-on-ROI totals per level (index 0 = level 1), recorded since history tracking began.
    function referralEarningsByLevel(address account) external view returns (LevelEarnings[15] memory) {
        return _levelEarnings[account];
    }

    function referralPaymentCount(address account) external view returns (uint256) {
        return _referralPayments[account].length;
    }

    /// @notice A page of ROI-on-ROI payments, oldest first.
    function referralPaymentsOf(address account, uint256 offset, uint256 limit) external view returns (ReferralPayment[] memory page) {
        ReferralPayment[] storage list = _referralPayments[account];
        if (offset >= list.length) return new ReferralPayment[](0);
        uint256 end = offset + limit > list.length ? list.length : offset + limit;
        page = new ReferralPayment[](end - offset);
        for (uint256 i = offset; i < end; ++i) page[i - offset] = list[i];
    }

    function setRewardMode(RewardMode mode) external nonReentrant whenNotPaused {
        if (!members[msg.sender].registered) revert InvalidReferrer();
        rewardMode[msg.sender] = mode;
        emit RewardModeSet(msg.sender, mode);
    }

    function claimRoi() external nonReentrant whenNotPaused returns (uint256 amount) {
        uint256 profit;
        bool compoundClaim;
        Position[] storage positions = _positions[msg.sender];
        for (uint256 i; i < positions.length; ++i) {
            Position storage position = positions[i];
            uint256 earned = _earned(position, block.timestamp);
            if (earned > position.claimed) {
                amount += earned - position.claimed;
                profit += _profitBetween(position, position.claimed, earned);
                if (position.plan >= Plan.Starter) compoundClaim = true;
                position.claimed = uint128(earned);
            }
        }
        if (amount == 0) revert NothingToClaim();
        // Compound profit is explicitly withdrawable continuously; ROI wallet claims retain $5 minimum.
        if (!compoundClaim && amount < MIN_CLAIM_USD * unit) revert BelowMinimumClaim(MIN_CLAIM_USD * unit);
        _requireBalance(amount);
        paymentToken.safeTransfer(msg.sender, amount);
        totalRewardsPaid += amount;
        emit RoiClaimed(msg.sender, amount);
        _payReferralRoi(msg.sender, profit);
    }

    /// @dev Retained for ABI compatibility. Selected compound positions accrue without a keeper.
    function processAutoCompound(address account) external nonReentrant whenNotPaused returns (uint256 created) {
        if (!members[account].registered || rewardMode[account] != RewardMode.AutoCompound) {
            revert AutoCompoundDisabled();
        }
        return 0;
    }

    function autoCompoundCarry(address account) external view returns (uint256) {
        return rewardMode[account] == RewardMode.AutoCompound ? pendingRoi(account) : 0;
    }

    function unrecordedAutoCompoundDays(address) external pure returns (uint256) { return 0; }

    function _earned(Position storage position, uint256 at) private view returns (uint256) {
        if (at <= position.startedAt) return 0;
        uint256 until = at < position.endsAt ? at : position.endsAt;
        uint256 secondsEarned = _businessSecondsUntil(until) - _businessSecondsUntil(position.startedAt);
        uint256 accrued = uint256(position.principal) * position.dailyRateBps * secondsEarned / DAY / BPS;
        if (position.plan < Plan.Starter) {
            uint256 maximum = uint256(position.principal) * 2;
            return accrued < maximum ? accrued : maximum;
        }
        return at < position.endsAt ? accrued : accrued + position.principal;
    }

    function _profitBetween(Position storage position, uint256 from, uint256 to) private view returns (uint256) {
        if (position.plan < Plan.Starter) return to / 2 - from / 2;
        uint256 termProfit = uint256(position.principal) * position.dailyRateBps
            * (_businessSecondsUntil(position.endsAt) - _businessSecondsUntil(position.startedAt)) / DAY / BPS;
        uint256 a = from < termProfit ? from : termProfit;
        uint256 b = to < termProfit ? to : termProfit;
        return b - a;
    }

    function claimSalary() external nonReentrant whenNotPaused returns (uint256 amount) {
        Member storage member = members[msg.sender];
        _refreshSalary(msg.sender);
        if (member.salaryRank == 0 || member.salaryClaims >= 6) revert NothingToClaim();
        uint256 cyclesElapsed = (block.timestamp - member.salaryStartedAt) / SALARY_CYCLE;
        uint256 available = cyclesElapsed > 6 ? 6 : cyclesElapsed;
        if (available <= member.salaryClaims) revert NothingToClaim();
        uint8 cycles = uint8(available - member.salaryClaims);
        amount = uint256(salaryAmountUsd[member.salaryRank - 1]) * unit * cycles;
        member.salaryClaims += cycles;
        _requireBalance(amount);
        paymentToken.safeTransfer(msg.sender, amount);
        totalRewardsPaid += amount;
        emit SalaryClaimed(msg.sender, member.salaryRank, member.salaryClaims, amount);
    }

    function fundRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsFunded(msg.sender, amount);
    }

    function withdrawExcess(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAmount();
        paymentToken.safeTransfer(to, amount);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseSet(value);
    }

    function planTerms(uint256 amount, Plan plan) public view returns (uint16 rate, uint32 earningDuration) {
        if (plan == Plan.Package1 && amount >= unit && amount <= 100 * unit) rate = 100;
        else if (plan == Plan.Package2 && amount >= 101 * unit && amount <= 500 * unit) rate = 110;
        else if (plan == Plan.Package3 && amount >= 501 * unit && amount <= 1_000 * unit) rate = 120;
        else if (plan == Plan.Package4 && amount >= 1_001 * unit && amount <= 2_500 * unit) rate = 130;
        else revert InvalidAmount();
        earningDuration = _packageDuration(rate);
    }

    /// @notice Selectable compound terms. Any package accepts $1-$2,500; the longer lock earns
    ///         the higher rate. Profit accrues continuously on earning days and principal unlocks
    ///         only when the term completes.
    function compoundTerms(uint256 amount, Plan plan) public view returns (uint16 rate, uint32 earningDuration) {
        if (amount < unit || amount > 2_500 * unit) revert InvalidAmount();
        uint256 earningDays;
        if (plan == Plan.Starter) { rate = 60; earningDays = 90; }
        else if (plan == Plan.Growth) { rate = 65; earningDays = 150; }
        else if (plan == Plan.Elite) { rate = 70; earningDays = 200; }
        else revert InvalidAmount();
        earningDuration = uint32(earningDays * DAY);
    }

    function _packageDuration(uint16 rate) private pure returns (uint32) {
        return uint32((uint256(MAX_PAYOUT_BPS) * DAY + rate - 1) / rate);
    }

    /// @notice Claimable ROI/compound profit now, including unlocked compound principal at maturity.
    function pendingRoi(address account) public view returns (uint256 amount) {
        Position[] storage positions = _positions[account];
        for (uint256 i; i < positions.length; ++i) {
            uint256 earned = _earned(positions[i], block.timestamp);
            if (earned > positions[i].claimed) amount += earned - positions[i].claimed;
        }
    }

    function positionsOf(address account) external view returns (Position[] memory) {
        return _positions[account];
    }

    /// @notice Complete live ROI details for every position. The array indexes match positionsOf.
    /// @dev This is a read-only helper and adds no proxy storage.
    function roiDetailsOf(address account) external view returns (PositionRoiDetails[] memory details) {
        Position[] storage positions = _positions[account];
        details = new PositionRoiDetails[](positions.length);
        for (uint256 i; i < positions.length; ++i) {
            Position storage position = positions[i];
            uint256 accrued = _earned(position, block.timestamp);
            uint256 claimed = position.claimed;
            uint256 profit = _profitBetween(position, 0, accrued);
            uint256 maximum;
            if (position.plan < Plan.Starter) maximum = uint256(position.principal) * 2;
            else {
                maximum = uint256(position.principal) + uint256(position.principal) * position.dailyRateBps
                    * (_businessSecondsUntil(position.endsAt) - _businessSecondsUntil(position.startedAt)) / DAY / BPS;
            }
            details[i] = PositionRoiDetails({
                accruedPayout: accrued,
                claimedPayout: claimed,
                claimablePayout: accrued > claimed ? accrued - claimed : 0,
                profitAccrued: profit,
                capitalReturned: accrued - profit,
                maximumPayout: maximum,
                active: block.timestamp < position.endsAt
            });
        }
    }

    function qualifiedLevel(address account) public view returns (uint8) {
        Member storage m = members[account];
        uint256 balanced = _balancedBusiness(m);
        uint256 required = uint256(levelBusinessUsd[0]) * unit;
        if (balanced < required) return 0;
        required += uint256(levelBusinessUsd[1]) * unit;
        if (balanced < required) return 3;
        required += uint256(levelBusinessUsd[2]) * unit;
        if (balanced < required) return 7;
        required += uint256(levelBusinessUsd[3]) * unit;
        return balanced < required ? 11 : 15;
    }

    function balancedBusiness(address account) external view returns (uint256) {
        return _balancedBusiness(members[account]);
    }

    function currentSalaryRank(address account) public view returns (uint8 rank) {
        uint256 business = _balancedBusiness(members[account]);
        for (uint8 i; i < 5; ++i) if (business >= uint256(salaryBusinessUsd[i]) * unit) rank = i + 1;
    }

    function _register(address account, address sponsor, address referrer, Leg leg, Split, RewardMode mode) private {
        if (members[account].registered) revert AlreadyRegistered();
        if (referrer == address(0) || referrer == account || !members[referrer].registered) revert InvalidReferrer();
        if (directLeg[referrer][leg] != address(0)) revert LegOccupied();
        if (sponsor == address(0)) sponsor = referrer;
        if (sponsor != referrer && (sponsor == account || !members[sponsor].registered || !_isUpline(sponsor, referrer))) {
            revert InvalidSponsor();
        }
        members[account].registered = true;
        members[account].referrer = referrer;
        // Kept at its legacy zero value solely to preserve the deployed Member storage layout.
        // Level and salary qualification always use 50:50 business and never read this field.
        members[account].split = Split.A60B40;
        rewardMode[account] = mode;
        directLeg[referrer][leg] = account;
        sponsorOf[account] = sponsor;
        _directReferrals[sponsor].push(account);
        emit Registered(account, referrer, leg, Split.A60B40);
        emit Sponsored(account, sponsor);
        emit RewardModeSet(account, mode);
    }

    function _invest(address account, uint256 amount, Plan plan) private {
        if (!members[account].registered) revert InvalidReferrer();
        if (amount < unit || amount > 2_500 * unit) revert InvalidAmount();
        if (_positions[account].length >= MAX_POSITIONS) revert TooManyPositions();

        bool compound = plan >= Plan.Starter;
        if ((rewardMode[account] == RewardMode.AutoCompound) != compound) revert InvalidAmount();
        (uint16 rate, uint32 earningDuration) = compound
            ? compoundTerms(amount, plan)
            : planTerms(amount, plan);
        paymentToken.safeTransferFrom(account, address(this), amount);
        uint40 started = uint40(block.timestamp);
        uint40 ends = uint40(_addBusinessSeconds(started, earningDuration));
        _positions[account].push(Position(uint128(amount), 0, started, ends, rate, plan));
        originalPrincipal[account][_positions[account].length - 1] = amount;
        members[account].personalBusiness += uint128(amount);
        totalDeposited += amount;
        _propagateBusiness(account, amount);
        emit Invested(account, _positions[account].length - 1, amount, plan, rate, ends);
    }

    /**
     * @dev Returns cumulative Monday-Friday seconds since the Unix epoch. Unix day zero was a
     *      Thursday, so remainder days 0, 1, 4, 5 and 6 are earning days; 2 and 3 are weekends.
     */
    function _businessSecondsUntil(uint256 timestamp) private pure returns (uint256) {
        uint256 elapsedDays = timestamp / DAY;
        uint256 completeWeeks = elapsedDays / 7;
        uint256 remainderDays = elapsedDays % 7;
        uint256 weekdaysBeforeToday;

        if (remainderDays <= 2) weekdaysBeforeToday = remainderDays;
        else if (remainderDays <= 4) weekdaysBeforeToday = 2;
        else weekdaysBeforeToday = remainderDays - 2;

        uint256 earningSeconds = (completeWeeks * 5 + weekdaysBeforeToday) * DAY;
        if (remainderDays < 2 || remainderDays > 3) earningSeconds += timestamp % DAY;
        return earningSeconds;
    }


    function _addBusinessSeconds(uint256 timestamp, uint256 earningSeconds) private pure returns (uint256 cursor) {
        cursor = timestamp;
        while (earningSeconds != 0) {
            uint256 dayNumber = cursor / DAY;
            uint256 secondsIntoDay = cursor % DAY;
            uint256 weekday = (dayNumber + 4) % 7; // Sunday=0, Monday=1, ..., Saturday=6.

            if (weekday == 0 || weekday == 6) {
                uint256 daysUntilMonday = weekday == 6 ? 2 : 1;
                cursor = (dayNumber + daysUntilMonday) * DAY;
                continue;
            }
            if (weekday == 1 && secondsIntoDay == 0 && earningSeconds >= 5 * DAY) {
                uint256 completeWeeks = earningSeconds / (5 * DAY);
                cursor += completeWeeks * 7 * DAY;
                earningSeconds -= completeWeeks * 5 * DAY;
                continue;
            }

            uint256 availableToday = DAY - secondsIntoDay;
            if (earningSeconds <= availableToday) return cursor + earningSeconds;
            earningSeconds -= availableToday;
            cursor = (dayNumber + 1) * DAY;
        }
    }

    function _propagateBusiness(address investor, uint256 amount) private {
        address child = investor;
        address upline = members[child].referrer;
        for (uint8 level = 1; level <= MAX_REFERRAL_LEVEL && upline != address(0); ++level) {
            if (directLeg[upline][Leg.A] == child) members[upline].legABusiness += uint128(amount);
            else members[upline].legBBusiness += uint128(amount);
            _refreshSalary(upline);
            child = upline;
            upline = members[child].referrer;
        }
    }

    function _payReferralRoi(address source, uint256 roi) private {
        address upline = members[source].referrer;
        for (uint8 level = 1; level <= MAX_REFERRAL_LEVEL && upline != address(0); ++level) {
            if (qualifiedLevel(upline) >= level) {
                uint256 reward = roi * referralRateBps[level - 1] / BPS;
                // ROI-mode level income is limited to 3x the earner's fresh wallet deposits.
                // Every later deposit adds another 3x capacity; prior payments never reset.
                if (rewardMode[upline] == RewardMode.ROI) {
                    uint256 cap = uint256(members[upline].personalBusiness) * 3;
                    uint256 paid = referralEarnings[upline];
                    if (paid >= cap) reward = 0;
                    else if (reward > cap - paid) reward = cap - paid;
                }
                if (reward != 0 && paymentToken.balanceOf(address(this)) >= reward) {
                    paymentToken.safeTransfer(upline, reward);
                    referralEarnings[upline] += reward;
                    _referralPayments[upline].push(ReferralPayment(uint128(reward), uint40(block.timestamp), level, source));
                    LevelEarnings storage earned = _levelEarnings[upline][level - 1];
                    earned.total += uint128(reward);
                    earned.lastPaidAt = uint40(block.timestamp);
                    earned.payments += 1;
                    totalRewardsPaid += reward;
                    emit ReferralPaid(upline, source, level, reward);
                }
            }
            upline = members[upline].referrer;
        }
    }

    function _balancedBusiness(Member storage member) private view returns (uint256) {
        uint256 a = member.legABusiness;
        uint256 b = member.legBBusiness;
        // Qualification is 50:50 by volume. Each matched dollar represents one dollar from both
        // organizations, so $50 + $50 produces $100 of balanced business. The people contributing
        // on either side may differ; only each organization's total deposit volume matters.
        return (a < b ? a : b) * 2;
    }

    function _refreshSalary(address account) private {
        Member storage member = members[account];
        uint8 rank = currentSalaryRank(account);
        if (rank > member.salaryRank) {
            member.salaryRank = rank;
            member.salaryClaims = 0;
            member.salaryStartedAt = uint40(block.timestamp);
            emit SalaryActivated(account, rank, _balancedBusiness(member));
        }
    }

    function _isUpline(address candidate, address node) private view returns (bool) {
        for (uint256 depth; depth < 64 && node != address(0); ++depth) {
            node = members[node].referrer;
            if (node == candidate) return true;
        }
        return false;
    }

    function _requireBalance(uint256 amount) private view {
        if (paymentToken.balanceOf(address(this)) < amount) revert Insolvent();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[36] private __gap;
}
