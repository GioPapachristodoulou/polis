// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PolisMarket - A binary prediction market with LMSR-inspired pricing
/// @notice Each market has YES/NO outcomes. Users buy shares; price moves with demand.
/// @dev Deployed by PolisFactory. Resolved via Flare FTSO oracle data.
contract PolisMarket is ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════
    //                           TYPES
    // ═══════════════════════════════════════════════════════════════════

    enum Outcome { UNRESOLVED, YES, NO, INVALID }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice The factory that created this market
    address public immutable factory;

    /// @notice Human-readable question for the market
    string public question;

    /// @notice Detailed resolution criteria
    string public resolutionCriteria;

    /// @notice FTSO feed ID used for resolution (if price-based market)
    bytes21 public feedId;

    /// @notice Strike price for resolution (scaled by feed decimals)
    uint256 public strikePrice;

    /// @notice Whether the outcome is: price >= strikePrice → YES, else → NO
    bool public isAboveStrike;

    /// @notice Unix timestamp when market stops accepting trades
    uint256 public expiryTimestamp;

    /// @notice Unix timestamp when market can be resolved
    uint256 public resolutionTimestamp;

    /// @notice Current outcome
    Outcome public outcome;

    /// @notice Total shares in each outcome pool (for AMM pricing)
    uint256 public yesPool;
    uint256 public noPool;

    /// @notice Liquidity parameter (controls price sensitivity)
    uint256 public constant LIQUIDITY_PARAM = 1000e18;

    /// @notice Total value locked in the market
    uint256 public totalDeposited;

    /// @notice User positions
    mapping(address => Position) public positions;

    /// @notice Agent conviction scores (for the POLIS agent consensus layer)
    mapping(address => uint8) public agentConvictions;
    address[] public convictionVoters;

    /// @notice Market metadata set by the Scout agent
    string public category;
    uint8 public confidenceScore; // 0-100, set by agent consensus

    // ═══════════════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event SharesPurchased(address indexed buyer, bool isYes, uint256 shares, uint256 cost);
    event SharesSold(address indexed seller, bool isYes, uint256 shares, uint256 payout);
    event MarketResolved(Outcome outcome, uint256 resolvedPrice);
    event Redeemed(address indexed user, uint256 payout);
    event ConvictionRecorded(address indexed agent, uint8 score);
    event LiquidityAdded(address indexed provider, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════
    //                          MODIFIERS
    // ═══════════════════════════════════════════════════════════════════

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier onlyActive() {
        require(outcome == Outcome.UNRESOLVED, "Market resolved");
        require(block.timestamp < expiryTimestamp, "Market expired");
        _;
    }

    modifier onlyExpired() {
        require(block.timestamp >= resolutionTimestamp, "Too early");
        require(outcome == Outcome.UNRESOLVED, "Already resolved");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor() {
        factory = msg.sender;
    }

    /// @notice Initialize the market (called by factory)
    function initialize(
        string calldata _question,
        string calldata _resolutionCriteria,
        bytes21 _feedId,
        uint256 _strikePrice,
        bool _isAboveStrike,
        uint256 _expiryTimestamp,
        uint256 _resolutionTimestamp,
        string calldata _category
    ) external onlyFactory {
        question = _question;
        resolutionCriteria = _resolutionCriteria;
        feedId = _feedId;
        strikePrice = _strikePrice;
        isAboveStrike = _isAboveStrike;
        expiryTimestamp = _expiryTimestamp;
        resolutionTimestamp = _resolutionTimestamp;
        category = _category;

        // Initialize pools with equal liquidity (50/50 odds)
        yesPool = LIQUIDITY_PARAM;
        noPool = LIQUIDITY_PARAM;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     AMM PRICING ENGINE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get the current price of YES shares (in basis points, 0-10000)
    function getYesPrice() public view returns (uint256) {
        return (noPool * 10000) / (yesPool + noPool);
    }

    /// @notice Get the current price of NO shares (in basis points, 0-10000)
    function getNoPrice() public view returns (uint256) {
        return (yesPool * 10000) / (yesPool + noPool);
    }

    /// @notice Calculate cost to buy `amount` of YES or NO shares
    /// @dev Uses constant-product invariant: yesPool * noPool = k
    function getCost(bool _isYes, uint256 _shares) public view returns (uint256) {
        uint256 k = yesPool * noPool;
        uint256 newPool;
        uint256 otherPool;

        if (_isYes) {
            newPool = yesPool + _shares;
            otherPool = k / newPool;
            return (noPool - otherPool);
        } else {
            newPool = noPool + _shares;
            otherPool = k / newPool;
            return (yesPool - otherPool);
        }
    }

    /// @notice Calculate payout for selling `amount` of YES or NO shares
    function getSaleReturn(bool _isYes, uint256 _shares) public view returns (uint256) {
        uint256 k = yesPool * noPool;
        uint256 newPool;
        uint256 otherPool;

        if (_isYes) {
            require(yesPool > _shares, "Insufficient pool");
            newPool = yesPool - _shares;
            otherPool = k / newPool;
            return (otherPool - noPool);
        } else {
            require(noPool > _shares, "Insufficient pool");
            newPool = noPool - _shares;
            otherPool = k / newPool;
            return (otherPool - yesPool);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        TRADING
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Buy YES or NO shares
    function buyShares(bool _isYes, uint256 _minShares) external payable onlyActive nonReentrant {
        require(msg.value > 0, "Must send value");

        // Calculate shares from constant-product AMM
        uint256 shares = _calculateSharesForDeposit(_isYes, msg.value);
        require(shares >= _minShares, "Slippage exceeded");

        // Update pools
        if (_isYes) {
            noPool += msg.value;
            yesPool -= shares;
            positions[msg.sender].yesShares += shares;
        } else {
            yesPool += msg.value;
            noPool -= shares;
            positions[msg.sender].noShares += shares;
        }

        totalDeposited += msg.value;

        emit SharesPurchased(msg.sender, _isYes, shares, msg.value);
    }

    /// @notice Sell YES or NO shares back to the pool
    function sellShares(bool _isYes, uint256 _shares, uint256 _minReturn) external onlyActive nonReentrant {
        if (_isYes) {
            require(positions[msg.sender].yesShares >= _shares, "Insufficient shares");
        } else {
            require(positions[msg.sender].noShares >= _shares, "Insufficient shares");
        }

        uint256 payout = getSaleReturn(_isYes, _shares);
        require(payout >= _minReturn, "Slippage exceeded");

        // Update pools and positions
        if (_isYes) {
            yesPool += _shares;
            noPool -= payout;
            positions[msg.sender].yesShares -= _shares;
        } else {
            noPool += _shares;
            yesPool -= payout;
            positions[msg.sender].noShares -= _shares;
        }

        totalDeposited -= payout;

        (bool success, ) = payable(msg.sender).call{value: payout}("");
        require(success, "Transfer failed");

        emit SharesSold(msg.sender, _isYes, _shares, payout);
    }

    /// @dev Calculate shares received for a given deposit using constant-product
    function _calculateSharesForDeposit(bool _isYes, uint256 _deposit) internal view returns (uint256) {
        uint256 k = yesPool * noPool;
        if (_isYes) {
            uint256 newNoPool = noPool + _deposit;
            uint256 newYesPool = k / newNoPool;
            return yesPool - newYesPool;
        } else {
            uint256 newYesPool = yesPool + _deposit;
            uint256 newNoPool = k / newYesPool;
            return noPool - newNoPool;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     AGENT CONVICTION LAYER
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Record an agent's conviction score for this market
    /// @param _agent The agent address
    /// @param _score Conviction score 0-100
    function recordConviction(address _agent, uint8 _score) external onlyFactory {
        require(_score <= 100, "Score 0-100");
        if (agentConvictions[_agent] == 0) {
            convictionVoters.push(_agent);
        }
        agentConvictions[_agent] = _score;
        emit ConvictionRecorded(_agent, _score);
    }

    /// @notice Get the aggregate conviction score from all agents
    function getAggregateConviction() external view returns (uint256 avgScore, uint256 voterCount) {
        voterCount = convictionVoters.length;
        if (voterCount == 0) return (0, 0);

        uint256 total;
        for (uint256 i; i < voterCount; i++) {
            total += agentConvictions[convictionVoters[i]];
        }
        avgScore = total / voterCount;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        RESOLUTION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Resolve the market with a price from FTSO
    /// @param _resolvedPrice The price from the FTSO oracle at resolution time
    function resolve(uint256 _resolvedPrice) external onlyFactory onlyExpired {
        if (isAboveStrike) {
            outcome = _resolvedPrice >= strikePrice ? Outcome.YES : Outcome.NO;
        } else {
            outcome = _resolvedPrice < strikePrice ? Outcome.YES : Outcome.NO;
        }
        emit MarketResolved(outcome, _resolvedPrice);
    }

    /// @notice Force-resolve as INVALID (emergency, factory only)
    function resolveInvalid() external onlyFactory {
        outcome = Outcome.INVALID;
        emit MarketResolved(Outcome.INVALID, 0);
    }

    /// @notice Redeem winning shares for payout
    function redeem() external nonReentrant {
        require(outcome != Outcome.UNRESOLVED, "Not resolved");

        Position storage pos = positions[msg.sender];
        uint256 payout;

        if (outcome == Outcome.INVALID) {
            // Refund proportionally
            uint256 totalShares = pos.yesShares + pos.noShares;
            payout = (totalShares * address(this).balance) / (yesPool + noPool);
        } else if (outcome == Outcome.YES) {
            payout = pos.yesShares;
        } else {
            payout = pos.noShares;
        }

        require(payout > 0, "Nothing to redeem");

        // Clear position
        pos.yesShares = 0;
        pos.noShares = 0;

        // Cap payout at contract balance
        if (payout > address(this).balance) {
            payout = address(this).balance;
        }

        (bool success, ) = payable(msg.sender).call{value: payout}("");
        require(success, "Transfer failed");

        emit Redeemed(msg.sender, payout);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          VIEWS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get full market info
    function getMarketInfo() external view returns (
        string memory _question,
        bytes21 _feedId,
        uint256 _strikePrice,
        uint256 _expiryTimestamp,
        Outcome _outcome,
        uint256 _yesPrice,
        uint256 _noPrice,
        uint256 _totalDeposited,
        string memory _category,
        uint8 _confidenceScore
    ) {
        return (
            question,
            feedId,
            strikePrice,
            expiryTimestamp,
            outcome,
            getYesPrice(),
            getNoPrice(),
            totalDeposited,
            category,
            confidenceScore
        );
    }

    /// @notice Get a user's position
    function getPosition(address _user) external view returns (uint256 yesShares, uint256 noShares) {
        Position storage pos = positions[_user];
        return (pos.yesShares, pos.noShares);
    }

    /// @notice Accept ETH for liquidity
    receive() external payable {
        emit LiquidityAdded(msg.sender, msg.value);
    }
}
