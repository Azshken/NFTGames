// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SoulKey} from "../contracts/SoulKey.sol";
import {MasterKeyVault} from "../contracts/MasterKeyVault.sol";

/**
 * @notice Deploys a new SoulKey game contract and registers it with the
 *         already-deployed MasterKeyVault. Run once per game.
 *
 * Usage:
 *   forge script script/DeployGameContract.s.sol \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify
 *
 * Required env vars:
 *   VAULT_ADDRESS     — deployed MasterKeyVault address
 *   GAME_NAME         — ERC-721 name  (e.g. "Fallout")
 *   GAME_SYMBOL       — ERC-721 symbol (e.g. "FALL")
 *   GAME_SUPPLY       — max mintable supply (e.g. 500)
 *   BASE_TOKEN_URI    — metadata base URI (e.g. "https://api.example.com/metadata/")
 */
contract DeployGameContract is Script {
    function run() external {
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        string memory name = vm.envString("GAME_NAME");
        string memory symbol = vm.envString("GAME_SYMBOL");
        uint64 supply = uint64(vm.envUint("GAME_SUPPLY"));
        string memory baseURI = vm.envString("BASE_TOKEN_URI");

        // Sanity checks before broadcasting
        require(vaultAddress != address(0), "VAULT_ADDRESS not set");
        require(supply > 0, "GAME_SUPPLY must be > 0");

        vm.startBroadcast();

        SoulKey soulKey = new SoulKey(
            vaultAddress,
            baseURI,
            name,
            symbol,
            supply
        );

        // Incompatible with multisig vault ownership
        // // Register immediately — msg.sender must be vault owner
        // MasterKeyVault(payable(vaultAddress)).registerGame(address(soulKey));

        vm.stopBroadcast();

        console.log("==============================================");
        console.log("SoulKey deployed:  ", address(soulKey));
        console.log("Game name:         ", name);
        console.log("Symbol:            ", symbol);
        console.log("Max supply:        ", supply);
        console.log("Vault:             ", vaultAddress);
        console.log("==============================================");
        console.log("Next step: go to /admin and run 'Register Game'");
        console.log("to create the products DB entry for this contract.");
    }
}
