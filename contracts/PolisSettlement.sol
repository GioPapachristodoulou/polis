// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title IERC20 minimal interface
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title PolisSettlement - Stablecoin settlement layer for POLIS on Plasma
/// @notice Handles prediction market payouts in USDT/stablecoins on Plasma's 
///         zero-fee payment infrastructure. AI agents trigger settlements autonomously.
/// @dev Deployed on Plasma chain. Leverages Plasma's zero-fee USDT transfers.
contract PolisSettlement is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════
    //                           TYPES
    // ═══════════════════════════════════════════════════════════════════

    enum SettlementStatus { PENDING, COMPLETED, CANCELLED }

    struct Settlement {
        uint256 id;
        address market;         // Corresponding market on Flare
        address recipient;
        uint256 amount;
        address token;          // Stablecoin address (USDT on Plasma)
        SettlementStatus status;
        uint256 createdAt;
        uint256 completedAt;
        string marketQuestion;  // For reference
    }

    struct BatchSettlement {
        uint256 batchId;
        address market;
        address[] recipients;
        uint256[] amounts;
        address token;
        SettlementStatus status;
        uint256 createdAt;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice All settlements
    Settlement[] public settlements;

    /// @notice Batch settlements
    BatchSettlement[] public batchSettlements;

    /// @notice Whitelisted stablecoins
    mapping(address => bool) public whitelistedTokens;

    /// @notice Authorized settlement agents
    mapping(address => bool) public authorizedAgents;

    /// @notice Total settled per token
    mapping(address => uint256) public totalSettled;

    /// @notice User's total earnings
    mapping(address => uint256) public userEarnings;

    /// @notice Settlement count
    uint256 public settlementCount;
    uint256 public batchCount;

    // ═══════════════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event SettlementCreated(uint256 indexed id, address indexed market, address recipient, uint256 amount);
    event SettlementCompleted(uint256 indexed id, address indexed recipient, uint256 amount);
    event BatchSettlementCreated(uint256 indexed batchId, address indexed market, uint256 recipientCount);
    event BatchSettlementCompleted(uint256 indexed batchId, uint256 totalAmount);
    event TokenWhitelisted(address indexed token);
    event AgentAuthorized(address indexed agent);

    // ═══════════════════════════════════════════════════════════════════
    //                          MODIFIERS
    // ═══════════════════════════════════════════════════════════════════

    modifier onlyAuthorized() {
        require(authorizedAgents[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════════════════
    //                        ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function whitelistToken(address _token) external onlyOwner {
        whitelistedTokens[_token] = true;
        emit TokenWhitelisted(_token);
    }

    function authorizeAgent(address _agent) external onlyOwner {
        authorizedAgents[_agent] = true;
        emit AgentAuthorized(_agent);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                   SINGLE SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Create and execute a settlement payout
    /// @dev On Plasma, USDT transfers are zero-fee, making micro-settlements viable
    function settle(
        address _market,
        address _recipient,
        uint256 _amount,
        address _token,
        string calldata _marketQuestion
    ) external onlyAuthorized nonReentrant returns (uint256) {
        require(whitelistedTokens[_token], "Token not whitelisted");
        require(_amount > 0, "Zero amount");
        require(_recipient != address(0), "Zero address");

        uint256 id = settlementCount++;

        settlements.push(Settlement({
            id: id,
            market: _market,
            recipient: _recipient,
            amount: _amount,
            token: _token,
            status: SettlementStatus.COMPLETED,
            createdAt: block.timestamp,
            completedAt: block.timestamp,
            marketQuestion: _marketQuestion
        }));

        // Execute the stablecoin transfer (zero-fee on Plasma!)
        require(
            IERC20(_token).transfer(_recipient, _amount),
            "Transfer failed"
        );

        totalSettled[_token] += _amount;
        userEarnings[_recipient] += _amount;

        emit SettlementCreated(id, _market, _recipient, _amount);
        emit SettlementCompleted(id, _recipient, _amount);

        return id;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                   BATCH SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Batch settle multiple winners from a single market
    /// @dev Leverages Plasma's high throughput for efficient batch payouts
    function batchSettle(
        address _market,
        address[] calldata _recipients,
        uint256[] calldata _amounts,
        address _token
    ) external onlyAuthorized nonReentrant returns (uint256) {
        require(whitelistedTokens[_token], "Token not whitelisted");
        require(_recipients.length == _amounts.length, "Length mismatch");
        require(_recipients.length > 0, "Empty batch");

        uint256 batchId = batchCount++;
        uint256 totalAmount;

        batchSettlements.push(BatchSettlement({
            batchId: batchId,
            market: _market,
            recipients: _recipients,
            amounts: _amounts,
            token: _token,
            status: SettlementStatus.COMPLETED,
            createdAt: block.timestamp
        }));

        IERC20 token = IERC20(_token);

        for (uint256 i; i < _recipients.length; i++) {
            require(_recipients[i] != address(0), "Zero address");
            require(_amounts[i] > 0, "Zero amount");

            require(token.transfer(_recipients[i], _amounts[i]), "Transfer failed");

            userEarnings[_recipients[i]] += _amounts[i];
            totalAmount += _amounts[i];
        }

        totalSettled[_token] += totalAmount;

        emit BatchSettlementCreated(batchId, _market, _recipients.length);
        emit BatchSettlementCompleted(batchId, totalAmount);

        return batchId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          VIEWS
    // ═══════════════════════════════════════════════════════════════════

    function getSettlementCount() external view returns (uint256) {
        return settlementCount;
    }

    function getBatchCount() external view returns (uint256) {
        return batchCount;
    }

    function getUserEarnings(address _user) external view returns (uint256) {
        return userEarnings[_user];
    }

    function getSettlement(uint256 _id) external view returns (Settlement memory) {
        return settlements[_id];
    }

    /// @notice Deposit stablecoins for future settlements
    function deposit(address _token, uint256 _amount) external {
        require(whitelistedTokens[_token], "Token not whitelisted");
        require(
            IERC20(_token).transferFrom(msg.sender, address(this), _amount),
            "Deposit failed"
        );
    }

    /// @notice Emergency withdraw
    function emergencyWithdraw(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(IERC20(_token).transfer(owner(), balance), "Withdraw failed");
    }

    receive() external payable {}
}
