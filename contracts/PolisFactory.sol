// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PolisMarket.sol";
import "./interfaces/IFlare.sol";

/// @title PolisFactory - Autonomous prediction market factory powered by Flare FTSO
/// @notice Creates and manages binary prediction markets. AI agents call this 
///         contract to propose, deploy, and resolve markets using Flare oracle data.
/// @dev Integrates with Flare's FTSO for price feeds and FDC for external data
contract PolisFactory is Ownable {
    // ═══════════════════════════════════════════════════════════════════
    //                           TYPES
    // ═══════════════════════════════════════════════════════════════════

    struct MarketMetadata {
        address marketAddress;
        string question;
        bytes21 feedId;
        uint256 strikePrice;
        uint256 expiryTimestamp;
        uint256 createdAt;
        address createdBy;
        bool resolved;
    }

    struct AgentInfo {
        string agentType; // "scout", "architect", "oracle", "marketmaker", "sentinel"
        bool isActive;
        uint256 marketsCreated;
        uint256 marketsResolved;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Flare Contract Registry address on Coston2
    /// @dev On Coston2: 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
    address public constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    /// @notice All deployed markets
    PolisMarket[] public markets;

    /// @notice Market metadata by address
    mapping(address => MarketMetadata) public marketMeta;

    /// @notice Registered AI agents
    mapping(address => AgentInfo) public agents;
    address[] public agentList;

    /// @notice Protocol fee (in basis points)
    uint256 public protocolFeeBps = 100; // 1%

    /// @notice Common FTSO Feed IDs
    bytes21 public constant FLR_USD = 0x01464c522f55534400000000000000000000000000;
    bytes21 public constant BTC_USD = 0x014254432f55534400000000000000000000000000;
    bytes21 public constant ETH_USD = 0x014554482f55534400000000000000000000000000;
    bytes21 public constant XRP_USD = 0x015852502f55534400000000000000000000000000;

    // ═══════════════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event MarketCreated(
        address indexed market,
        string question,
        bytes21 feedId,
        uint256 strikePrice,
        uint256 expiryTimestamp,
        address indexed createdBy
    );

    event MarketResolved(
        address indexed market,
        PolisMarket.Outcome outcome,
        uint256 resolvedPrice
    );

    event AgentRegistered(address indexed agent, string agentType);
    event AgentDeactivated(address indexed agent);

    event ConvictionConsensus(
        address indexed market,
        uint256 avgConviction,
        uint256 voterCount,
        bool approved
    );

    // ═══════════════════════════════════════════════════════════════════
    //                          MODIFIERS
    // ═══════════════════════════════════════════════════════════════════

    modifier onlyAgent() {
        require(agents[msg.sender].isActive, "Not an active agent");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                        CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════════════════
    //                     AGENT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Register an AI agent
    function registerAgent(address _agent, string calldata _agentType) external onlyOwner {
        require(!agents[_agent].isActive, "Already registered");
        agents[_agent] = AgentInfo({
            agentType: _agentType,
            isActive: true,
            marketsCreated: 0,
            marketsResolved: 0
        });
        agentList.push(_agent);
        emit AgentRegistered(_agent, _agentType);
    }

    /// @notice Deactivate an agent
    function deactivateAgent(address _agent) external onlyOwner {
        agents[_agent].isActive = false;
        emit AgentDeactivated(_agent);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     MARKET CREATION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Create a new prediction market (called by Architect agent)
    /// @param _question Human-readable market question
    /// @param _resolutionCriteria How the market resolves
    /// @param _feedId FTSO feed ID for price-based resolution
    /// @param _strikePrice The price threshold for resolution
    /// @param _isAboveStrike If true: price >= strike → YES
    /// @param _expiryTimestamp When trading stops
    /// @param _resolutionTimestamp When market can be resolved
    /// @param _category Market category (e.g., "crypto", "macro", "sports")
    function createMarket(
        string calldata _question,
        string calldata _resolutionCriteria,
        bytes21 _feedId,
        uint256 _strikePrice,
        bool _isAboveStrike,
        uint256 _expiryTimestamp,
        uint256 _resolutionTimestamp,
        string calldata _category
    ) external onlyAgent returns (address) {
        require(_expiryTimestamp > block.timestamp, "Expiry must be future");
        require(_resolutionTimestamp >= _expiryTimestamp, "Resolution after expiry");

        // Deploy new market
        PolisMarket market = new PolisMarket();
        market.initialize(
            _question,
            _resolutionCriteria,
            _feedId,
            _strikePrice,
            _isAboveStrike,
            _expiryTimestamp,
            _resolutionTimestamp,
            _category
        );

        markets.push(market);
        marketMeta[address(market)] = MarketMetadata({
            marketAddress: address(market),
            question: _question,
            feedId: _feedId,
            strikePrice: _strikePrice,
            expiryTimestamp: _expiryTimestamp,
            createdAt: block.timestamp,
            createdBy: msg.sender,
            resolved: false
        });

        agents[msg.sender].marketsCreated++;

        emit MarketCreated(
            address(market),
            _question,
            _feedId,
            _strikePrice,
            _expiryTimestamp,
            msg.sender
        );

        return address(market);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                  AGENT CONVICTION CONSENSUS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Record an agent's conviction score for a market
    function recordConviction(address _market, uint8 _score) external onlyAgent {
        PolisMarket(payable(_market)).recordConviction(msg.sender, _score);
    }

    /// @notice Check if a market has sufficient agent consensus (>= 60 avg score)
    function hasConsensus(address _market) public view returns (bool approved, uint256 avgScore) {
        (uint256 avg, uint256 count) = PolisMarket(payable(_market)).getAggregateConviction();
        return (avg >= 60 && count >= 2, avg);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     FTSO ORACLE INTEGRATION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Fetch the latest price from Flare FTSO for a given feed
    /// @param _feedId The FTSO feed identifier
    /// @return price The current price value
    /// @return decimals The decimal precision
    /// @return timestamp When the price was last updated
    function getFTSOPrice(bytes21 _feedId) public view returns (
        uint256 price,
        int8 decimals,
        uint64 timestamp
    ) {
        // Get FTSO V2 contract address from Flare's registry
        IFlareContractRegistry registry = IFlareContractRegistry(FLARE_CONTRACT_REGISTRY);
        address ftsoAddress = registry.getContractAddressByName("FtsoV2");
        
        IFtsoV2 ftso = IFtsoV2(ftsoAddress);
        return ftso.getFeedById(_feedId);
    }

    /// @notice Fetch multiple prices at once
    function getFTSOPrices(bytes21[] calldata _feedIds) public view returns (
        uint256[] memory prices,
        int8[] memory decimals,
        uint64 timestamp
    ) {
        IFlareContractRegistry registry = IFlareContractRegistry(FLARE_CONTRACT_REGISTRY);
        address ftsoAddress = registry.getContractAddressByName("FtsoV2");
        
        IFtsoV2 ftso = IFtsoV2(ftsoAddress);
        return ftso.getFeedsById(_feedIds);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                     MARKET RESOLUTION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Resolve a market using live FTSO price data (called by Oracle agent)
    function resolveMarket(address _market) external onlyAgent {
        MarketMetadata storage meta = marketMeta[_market];
        require(!meta.resolved, "Already resolved");

        PolisMarket market = PolisMarket(payable(_market));
        bytes21 feedId = market.feedId();

        // Fetch live price from Flare FTSO
        (uint256 price, , ) = getFTSOPrice(feedId);

        // Resolve the market with the FTSO price
        market.resolve(price);
        meta.resolved = true;
        agents[msg.sender].marketsResolved++;

        emit MarketResolved(
            _market,
            market.outcome(),
            price
        );
    }

    /// @notice Emergency resolve as invalid
    function resolveMarketInvalid(address _market) external onlyOwner {
        PolisMarket(payable(_market)).resolveInvalid();
        marketMeta[_market].resolved = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                          VIEWS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get total number of markets
    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    /// @notice Get all market addresses
    function getAllMarkets() external view returns (PolisMarket[] memory) {
        return markets;
    }

    /// @notice Get all registered agents
    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Get active markets (not resolved, not expired)
    function getActiveMarkets() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i; i < markets.length; i++) {
            if (markets[i].outcome() == PolisMarket.Outcome.UNRESOLVED && 
                block.timestamp < markets[i].expiryTimestamp()) {
                count++;
            }
        }

        address[] memory active = new address[](count);
        uint256 idx;
        for (uint256 i; i < markets.length; i++) {
            if (markets[i].outcome() == PolisMarket.Outcome.UNRESOLVED && 
                block.timestamp < markets[i].expiryTimestamp()) {
                active[idx++] = address(markets[i]);
            }
        }
        return active;
    }

    /// @notice Withdraw protocol fees
    function withdrawFees() external onlyOwner {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    receive() external payable {}
}
