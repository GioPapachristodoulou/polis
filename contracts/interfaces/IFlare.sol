// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFtsoV2 - Interface for Flare's FTSOv2 price oracle
/// @notice Mirrors the Flare TestFtsoV2Interface for Coston2 testnet
interface IFtsoV2 {
    /// @notice Get a single feed value by its ID
    function getFeedById(bytes21 _feedId)
        external
        view
        returns (uint256 _value, int8 _decimals, uint64 _timestamp);

    /// @notice Get a single feed value in wei by its ID
    function getFeedByIdInWei(bytes21 _feedId)
        external
        view
        returns (uint256 _value, uint64 _timestamp);

    /// @notice Get multiple feed values by their IDs
    function getFeedsById(bytes21[] calldata _feedIds)
        external
        view
        returns (
            uint256[] memory _values,
            int8[] memory _decimals,
            uint64 _timestamp
        );
}

/// @title IContractRegistry - Interface for Flare's Contract Registry
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata _name) external view returns (address);
}
