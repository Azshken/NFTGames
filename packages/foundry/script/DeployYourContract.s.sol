// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console} from "forge-std/Script.sol";
import "../contracts/SoulboundNFT.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Deploy script for SoulboundNFT contract
 * @dev Handles deployment for both local and live networks
 * Example:
 * yarn deploy --file DeployYourContract.s.sol  # local anvil chain
 * yarn deploy --file DeployYourContract.s.sol --network sepolia # live network (requires keystore)
 */

// Simple mock ERC20 for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1M tokens
    }
}

contract DeployYourContract is Script {
    // Sepolia testnet token addresses (Circle's official USDC and common USDT)
    address constant SEPOLIA_USDT = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0;
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    
    function run() public {
        uint256 deployerPrivateKey;
        address usdtAddress;
        address usdcAddress;
        
        // Only use localhost private key for local chains
        if (block.chainid == 31337) { // localhost/Anvil chain ID
            deployerPrivateKey = vm.envUint("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID");
            vm.startBroadcast(deployerPrivateKey);
            
            // Deploy mock tokens on localhost
            console.logString("Deploying mock USDT and USDC on localhost...");
            MockERC20 mockUSDT = new MockERC20("Mock USDT", "USDT");
            MockERC20 mockUSDC = new MockERC20("Mock USDC", "USDC");
            
            usdtAddress = address(mockUSDT);
            usdcAddress = address(mockUSDC);
            
            console.logString(
                string.concat("Mock USDT deployed at: ", vm.toString(usdtAddress))
            );
            console.logString(
                string.concat("Mock USDC deployed at: ", vm.toString(usdcAddress))
            );
            
        } else if (block.chainid == 11155111) { // Sepolia testnet
            // For live networks, use the keystore (already handled by --keystores flag)
            vm.startBroadcast();
            
            // Use existing Sepolia token addresses
            usdtAddress = SEPOLIA_USDT;
            usdcAddress = SEPOLIA_USDC;
            
            console.logString("Using existing Sepolia tokens:");
            console.logString(
                string.concat("USDT at: ", vm.toString(usdtAddress))
            );
            console.logString(
                string.concat("USDC at: ", vm.toString(usdcAddress))
            );
            
        } else {
            revert("Unsupported network. Please use localhost (31337) or Sepolia (11155111)");
        }
        
        // Deploy the SoulboundNFT contract
        SoulboundNFT soulboundContract = new SoulboundNFT(
            usdtAddress,
            usdcAddress
        );
        
        console.logString(
            string.concat(
                "SoulboundNFT deployed at: ",
                vm.toString(address(soulboundContract))
            )
        );

        vm.stopBroadcast();
    }
}