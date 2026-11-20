// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VantexCapital} from "../VantexCapital.sol";

/**
 * @dev Test-only second implementation used to prove UUPS upgrades preserve proxy storage.
 */
contract VantexCapitalV2 is VantexCapital {
    function version() external pure returns (uint256) {
        return 2;
    }
}
