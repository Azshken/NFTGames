// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;

// import "forge-std/Test.sol";
// import "../contracts/SoulboundNFT.sol"; // Adjust path to your contract

// contract SoulboundNFTTest is Test {
//     SoulboundNFT nft;
//     address owner = address(this);
//     address user1 = makeAddr("user1");
//     address user2 = makeAddr("user2");
//     string exampleCdKey = "ABCDE-12345-FGHIJ";

//     function setUp() public {
//         nft = new SoulboundNFT("Soulbound NFT", "GNFT");
//         // Assuming the contract has a way to mint with a hidden CD key
//         // If minting requires admin, set that up here
//     }

//     function testMintNftWithCdKey() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
//         assertEq(nft.ownerOf(tokenId), user1);
//         // Check that CD key is hidden/not directly accessible
//         // If there's a mapping or event, test accordingly
//     }

//     function testRevealCdKeyByOwner() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         string memory revealedKey = nft.revealCdKey(tokenId);
        
//         assertEq(revealedKey, exampleCdKey);
//         assertTrue(nft.isClaimed(tokenId)); // Assuming isClaimed function or similar
//     }

//     function testCannotRevealCdKeyByNonOwner() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.expectRevert("Not owner"); // Adjust to your revert message
//         vm.prank(user2);
//         nft.revealCdKey(tokenId);
//     }

//     function testCannotRevealCdKeyTwice() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
        
//         vm.expectRevert("Already claimed"); // Adjust to your revert message
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
//     }

//     function testTransferBeforeClaim() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.transferFrom(user1, user2, tokenId);
        
//         assertEq(nft.ownerOf(tokenId), user2);
//     }

//     function testCannotTransferAfterClaim() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
        
//         vm.expectRevert("Soulbound after claim"); // Adjust to your revert message
//         vm.prank(user1);
//         nft.transferFrom(user1, user2, tokenId);
//     }

//     // Edge cases from previous discussion
//     function testRevealInvalidTokenId() public {
//         vm.expectRevert("Invalid token ID"); // e.g., ERC721 non-existent token
//         nft.revealCdKey(999); // Non-existent token
//     }

//     function testMintWithEmptyCdKey() public {
//         vm.expectRevert("CD key required");
//         nft.mint(user1, ""); // Assuming contract checks for non-empty key
//     }

//     function testTransferToZeroAddressAfterClaim() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
        
//         vm.expectRevert("Soulbound after claim");
//         vm.prank(user1);
//         nft.transferFrom(user1, address(0), tokenId);
//     }

//     function testSafeTransferAfterClaim() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
        
//         vm.expectRevert("Soulbound after claim");
//         vm.prank(user1);
//         nft.safeTransferFrom(user1, user2, tokenId);
//     }

//     function testApproveAfterClaim() public {
//         uint256 tokenId = nft.mint(user1, exampleCdKey);
        
//         vm.prank(user1);
//         nft.revealCdKey(tokenId);
        
//         // Depending on implementation, may still allow approve but block transfer
//         // Test accordingly; if soulbound blocks approve:
//         vm.expectRevert("Soulbound: cannot approve");
//         vm.prank(user1);
//         nft.approve(user2, tokenId);
//     }
// }

// OG
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/SoulboundNFT.sol";

contract YourContractTest is Test {
    YourContract public yourContract;

    function setUp() public {
        yourContract = new YourContract(vm.addr(1));
    }

    function testMessageOnDeployment() public view {
        require(keccak256(bytes(yourContract.greeting())) == keccak256("Building Unstoppable Apps!!!"));
    }
}