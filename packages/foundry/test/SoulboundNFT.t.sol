// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SoulboundNFT} from "../contracts/SoulboundNFT.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ERC20 ============

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

// ============ Test Suite ============

contract SoulboundNFTTest is Test {
    SoulboundNFT public nft;
    MockERC20 public usdt;
    MockERC20 public usdc;

    // Actors
    address public owner = makeAddr("owner");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");
    address public attacker = makeAddr("attacker");

    // Pricing
    uint256 constant MINT_PRICE_ETH = 0.01 ether;
    uint256 constant MINT_PRICE_USD = 20e6;

    // Test CD key data
    bytes32 constant CD_KEY_HASH_1 =
        keccak256(abi.encodePacked("XXXX-YYYY-ZZZZ-1111"));
    bytes32 constant CD_KEY_HASH_2 =
        keccak256(abi.encodePacked("AAAA-BBBB-CCCC-2222"));
    bytes32 constant CD_KEY_HASH_3 =
        keccak256(abi.encodePacked("DDDD-EEEE-FFFF-3333"));

    bytes constant ENCRYPTED_KEY_1 = hex"deadbeef01";
    bytes constant ENCRYPTED_KEY_2 = hex"deadbeef02";

    // Merkle tree (2 leaves for simplicity)
    bytes32 public merkleRoot;
    bytes32[] public proofForHash1;
    bytes32[] public proofForHash2;
    bytes32[] public proofForHash3;

    // ============ Setup ============

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock tokens
        usdt = new MockERC20("Tether USD", "USDT");
        usdc = new MockERC20("USD Coin", "USDC");

        // Deploy NFT contract
        nft = new SoulboundNFT(
            address(usdt),
            address(usdc),
            "ipfs://bafybeiabc123"
        );

        // Build Merkle tree manually for 3 leaves
        // Leaf = keccak256(keccak256(commitmentHash))
        bytes32 leaf1 = keccak256(abi.encodePacked(CD_KEY_HASH_1));
        bytes32 leaf2 = keccak256(abi.encodePacked(CD_KEY_HASH_2));
        bytes32 leaf3 = keccak256(abi.encodePacked(CD_KEY_HASH_3));

        // Sort pairs (OpenZeppelin MerkleProof uses sorted pairs)
        bytes32 node12 = leaf1 < leaf2
            ? keccak256(abi.encodePacked(leaf1, leaf2))
            : keccak256(abi.encodePacked(leaf2, leaf1));

        bytes32 node3 = leaf3 < leaf3
            ? keccak256(abi.encodePacked(leaf3, leaf3))
            : keccak256(abi.encodePacked(leaf3, leaf3));

        // For odd number of leaves, last leaf is paired with itself
        bytes32 paddedLeaf3 = leaf3;
        bytes32 root = node12 < paddedLeaf3
            ? keccak256(abi.encodePacked(node12, paddedLeaf3))
            : keccak256(abi.encodePacked(paddedLeaf3, node12));

        merkleRoot = root;

        // Proof for leaf1: [leaf2, paddedLeaf3]
        proofForHash1 = new bytes32[](2);
        proofForHash1[0] = leaf2;
        proofForHash1[1] = paddedLeaf3;

        // Proof for leaf2: [leaf1, paddedLeaf3]
        proofForHash2 = new bytes32[](2);
        proofForHash2[0] = leaf1;
        proofForHash2[1] = paddedLeaf3;

        // Proof for leaf3: [node12]
        proofForHash3 = new bytes32[](1);
        proofForHash3[0] = node12;

        // Set Merkle root on contract
        nft.setMerkleRoot(merkleRoot);

        vm.stopPrank();

        // Fund accounts
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        vm.deal(attacker, 10 ether);

        usdt.mint(user1, 1000e6);
        usdc.mint(user1, 1000e6);
        usdt.mint(user2, 1000e6);
        usdc.mint(user2, 1000e6);
    }

    // ============ Deployment Tests ============

    function test_Deployment_CorrectName() public view {
        assertEq(nft.name(), "Fallout");
    }

    function test_Deployment_CorrectSymbol() public view {
        assertEq(nft.symbol(), "FALL");
    }

    function test_Deployment_CorrectOwner() public view {
        assertEq(nft.owner(), owner);
    }

    function test_Deployment_CorrectMintPrice() public view {
        assertEq(nft.mintPriceETH(), MINT_PRICE_ETH);
        assertEq(nft.mintPriceUSD(), MINT_PRICE_USD);
    }

    function test_Deployment_ZeroSupply() public view {
        assertEq(nft.totalSupply(), 0);
    }

    function test_Deployment_RevertsOnZeroAddress() public {
        vm.expectRevert(SoulboundNFT.ZeroAddress.selector);
        new SoulboundNFT(address(0), address(usdc), "ipfs://test");

        vm.expectRevert(SoulboundNFT.ZeroAddress.selector);
        new SoulboundNFT(address(usdt), address(0), "ipfs://test");
    }

    // ============ Merkle Root Tests ============

    function test_SetMerkleRoot_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        nft.setMerkleRoot(bytes32(uint256(1)));
    }

    function test_SetMerkleRoot_RevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(SoulboundNFT.InvalidCommitmentHash.selector);
        nft.setMerkleRoot(bytes32(0));
    }

    function test_SetMerkleRoot_EmitsEvent() public {
        bytes32 newRoot = bytes32(uint256(999));
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit SoulboundNFT.MerkleRootUpdated(merkleRoot, newRoot);
        nft.setMerkleRoot(newRoot);
    }

    function test_VerifyCommitmentHash_ValidProof() public view {
        assertTrue(nft.verifyCommitmentHash(CD_KEY_HASH_1, proofForHash1));
        assertTrue(nft.verifyCommitmentHash(CD_KEY_HASH_2, proofForHash2));
    }

    function test_VerifyCommitmentHash_InvalidProof() public view {
        // Use wrong proof
        assertFalse(nft.verifyCommitmentHash(CD_KEY_HASH_1, proofForHash2));
    }

    // ============ Mint with ETH Tests ============

    function test_MintWithETH_Success() public {
        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);

        assertEq(nft.ownerOf(1), user1);
        assertEq(nft.totalSupply(), 1);
    }

    function test_MintWithETH_RefundsExcess() public {
        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        nft.mintWithETH{value: 1 ether}(CD_KEY_HASH_1, proofForHash1);

        // Should only charge MINT_PRICE_ETH
        assertApproxEqAbs(
            user1.balance,
            balanceBefore - MINT_PRICE_ETH,
            0.001 ether
        );
    }

    function test_MintWithETH_RevertsInsufficientPayment() public {
        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.InsufficientPayment.selector);
        nft.mintWithETH{value: 0.001 ether}(CD_KEY_HASH_1, proofForHash1);
    }

    function test_MintWithETH_RevertsInvalidProof() public {
        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.InvalidCommitmentHash.selector);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash2); // wrong proof
    }

    function test_MintWithETH_RevertsNoMerkleRoot() public {
        // Deploy fresh contract with no root set
        SoulboundNFT fresh = new SoulboundNFT(
            address(usdt),
            address(usdc),
            "ipfs://test"
        );

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.MerkleRootNotSet.selector);
        fresh.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
    }

    function test_MintWithETH_RevertsZeroHash() public {
        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.InvalidCommitmentHash.selector);
        nft.mintWithETH{value: MINT_PRICE_ETH}(bytes32(0), proofForHash1);
    }

    function test_MintWithETH_RevertsReplayAttack() public {
        // First mint succeeds
        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);

        // Second mint with same hash should fail
        vm.prank(user2);
        vm.expectRevert(SoulboundNFT.CommitmentHashAlreadyUsed.selector);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
    }

    function test_MintWithETH_RevertsWhenPaused() public {
        vm.prank(owner);
        nft.pause();

        vm.prank(user1);
        vm.expectRevert();
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
    }

    function test_MintWithETH_RevertsMaxSupplyReached() public {
        // Set max supply to 1
        vm.prank(owner);
        nft.setMaxSupply(1);

        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);

        vm.prank(user2);
        vm.expectRevert(SoulboundNFT.MaxSupplyReached.selector);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_2, proofForHash2);
    }

    function test_MintWithETH_EmitsEvent() public {
        vm.prank(user1);
        vm.expectEmit(true, true, true, true);
        emit SoulboundNFT.NFTMinted(1, user1, address(0), CD_KEY_HASH_1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
    }

    // ============ Mint with USDT/USDC Tests ============

    function test_MintWithUSDT_Success() public {
        vm.startPrank(user1);
        usdt.approve(address(nft), MINT_PRICE_USD);
        nft.mintWithUSDT(CD_KEY_HASH_1, proofForHash1);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), user1);
        assertEq(usdt.balanceOf(address(nft)), MINT_PRICE_USD);
    }

    function test_MintWithUSDC_Success() public {
        vm.startPrank(user1);
        usdc.approve(address(nft), MINT_PRICE_USD);
        nft.mintWithUSDC(CD_KEY_HASH_1, proofForHash1);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), user1);
        assertEq(usdc.balanceOf(address(nft)), MINT_PRICE_USD);
    }

    function test_MintWithUSDT_EmitsEvent() public {
        vm.startPrank(user1);
        usdt.approve(address(nft), MINT_PRICE_USD);
        vm.expectEmit(true, true, true, true);
        emit SoulboundNFT.NFTMinted(1, user1, address(usdt), CD_KEY_HASH_1);
        nft.mintWithUSDT(CD_KEY_HASH_1, proofForHash1);
        vm.stopPrank();
    }

    // ============ Claim CD Key Tests ============

    function _mintToken(
        address user,
        bytes32 hash,
        bytes32[] memory proof
    ) internal returns (uint256) {
        vm.prank(user);
        nft.mintWithETH{value: MINT_PRICE_ETH}(hash, proof);
        return nft.totalSupply();
    }

    function test_ClaimCDKey_Success() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        assertTrue(nft.isClaimedToken(tokenId));
        assertGt(nft.getClaimTimestamp(tokenId), 0);
    }

    function test_ClaimCDKey_EmitsEvent() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit SoulboundNFT.CdKeyClaimed(tokenId, user1, CD_KEY_HASH_1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);
    }

    function test_ClaimCDKey_RevertsWrongOwner() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(attacker);
        vm.expectRevert(SoulboundNFT.NotTokenOwner.selector);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);
    }

    function test_ClaimCDKey_RevertsAlreadyClaimed() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.AlreadyClaimed.selector);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);
    }

    function test_ClaimCDKey_RevertsWrongHash() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.InvalidCommitmentHash.selector);
        nft.claimCdKey(tokenId, CD_KEY_HASH_2, ENCRYPTED_KEY_1); // wrong hash
    }

    // ============ Soulbound Transfer Tests ============

    function test_Transfer_AllowedBeforeClaim() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        // Transfer should work before claiming
        vm.prank(user1);
        nft.transferFrom(user1, user2, tokenId);

        assertEq(nft.ownerOf(tokenId), user2);
    }

    function test_Transfer_BlockedAfterClaim() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        // Transfer should be blocked after claiming
        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.CannotTransferClaimed.selector);
        nft.transferFrom(user1, user2, tokenId);
    }

    function test_Transfer_SafeTransferBlockedAfterClaim() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.CannotTransferClaimed.selector);
        nft.safeTransferFrom(user1, user2, tokenId);
    }

    // ============ Burn Tests ============

    function test_Burn_UnclaimedToken() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.burn(tokenId);

        assertEq(nft.totalSupply(), 0);
    }

    function test_Burn_ClaimedToken() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        // Claimed (soulbound) tokens are still burnable
        vm.prank(user1);
        nft.burn(tokenId);

        assertEq(nft.totalSupply(), 0);
    }

    function test_Burn_EmitsEventWithSoulboundFlag() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit SoulboundNFT.NFTBurned(tokenId, user1, true); // wasSoulbound = true
        nft.burn(tokenId);
    }

    function test_Burn_RevertsWrongOwner() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(attacker);
        vm.expectRevert(SoulboundNFT.NotTokenOwner.selector);
        nft.burn(tokenId);
    }

    function test_Burn_UpdatesTotalSupplyCorrectly() public {
        // Mint 2 tokens
        _mintToken(user1, CD_KEY_HASH_1, proofForHash1);
        _mintToken(user1, CD_KEY_HASH_2, proofForHash2);
        assertEq(nft.totalSupply(), 2);

        // Burn 1
        vm.prank(user1);
        nft.burn(1);
        assertEq(nft.totalSupply(), 1);
    }

    // ============ Get Encrypted CD Key Tests ============

    function test_GetEncryptedCDKey_Success() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        vm.prank(user1);
        bytes memory retrieved = nft.getEncryptedCDKey(tokenId);
        assertEq(retrieved, ENCRYPTED_KEY_1);
    }

    function test_GetEncryptedCDKey_RevertsNotOwner() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        nft.claimCdKey(tokenId, CD_KEY_HASH_1, ENCRYPTED_KEY_1);

        vm.prank(attacker);
        vm.expectRevert(SoulboundNFT.NotTokenOwner.selector);
        nft.getEncryptedCDKey(tokenId);
    }

    function test_GetEncryptedCDKey_RevertsNotClaimed() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.NotClaimed.selector);
        nft.getEncryptedCDKey(tokenId);
    }

    // ============ Admin Tests ============

    function test_SetMaxSupply_Success() public {
        vm.prank(owner);
        nft.setMaxSupply(100);
        assertEq(nft.maxSupply(), 100);
    }

    function test_SetMaxSupply_RevertsIfBelowMinted() public {
        _mintToken(user1, CD_KEY_HASH_1, proofForHash1);
        _mintToken(user1, CD_KEY_HASH_2, proofForHash2);

        vm.prank(owner);
        vm.expectRevert("Cannot set below current supply");
        nft.setMaxSupply(1);
    }

    function test_SetMintPrices_Success() public {
        vm.prank(owner);
        nft.setMintPrices(0.02 ether, 40e6);

        assertEq(nft.mintPriceETH(), 0.02 ether);
        assertEq(nft.mintPriceUSD(), 40e6);
    }

    function test_Pause_BlocksMinting() public {
        vm.prank(owner);
        nft.pause();

        vm.prank(user1);
        vm.expectRevert();
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
    }

    function test_Unpause_AllowsMinting() public {
        vm.prank(owner);
        nft.pause();

        vm.prank(owner);
        nft.unpause();

        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);
        assertEq(nft.totalSupply(), 1);
    }

    // ============ Withdraw Tests ============

    function test_WithdrawETH_Success() public {
        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);

        uint256 ownerBalanceBefore = owner.balance;

        vm.prank(owner);
        nft.withdrawETH();

        assertEq(owner.balance, ownerBalanceBefore + MINT_PRICE_ETH);
        assertEq(address(nft).balance, 0);
    }

    function test_WithdrawUSDT_Success() public {
        vm.startPrank(user1);
        usdt.approve(address(nft), MINT_PRICE_USD);
        nft.mintWithUSDT(CD_KEY_HASH_1, proofForHash1);
        vm.stopPrank();

        vm.prank(owner);
        nft.withdrawUSDT();

        assertEq(usdt.balanceOf(owner), MINT_PRICE_USD);
        assertEq(usdt.balanceOf(address(nft)), 0);
    }

    function test_WithdrawAll_Success() public {
        // Fund with ETH and USDT
        vm.prank(user1);
        nft.mintWithETH{value: MINT_PRICE_ETH}(CD_KEY_HASH_1, proofForHash1);

        vm.startPrank(user1);
        usdt.approve(address(nft), MINT_PRICE_USD);
        nft.mintWithUSDT(CD_KEY_HASH_2, proofForHash2);
        vm.stopPrank();

        uint256 ownerEthBefore = owner.balance;

        vm.prank(owner);
        nft.withdrawAll();

        assertEq(owner.balance, ownerEthBefore + MINT_PRICE_ETH);
        assertEq(usdt.balanceOf(owner), MINT_PRICE_USD);
        assertEq(address(nft).balance, 0);
    }

    function test_Withdraw_RevertsNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        nft.withdrawETH();
    }

    // ============ TokenURI Tests ============

    function test_TokenURI_ReturnsBaseURI() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);
        assertEq(nft.tokenURI(tokenId), "ipfs://bafybeiabc123");
    }

    function test_TokenURI_RevertsNonExistentToken() public {
        vm.expectRevert();
        nft.tokenURI(999);
    }

    function test_SetBaseURI_UpdatesURI() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(owner);
        nft.setBaseURI("ipfs://newcid123");

        assertEq(nft.tokenURI(tokenId), "ipfs://newcid123");
    }

    // ============ Ownable2Step Tests ============

    function test_Ownership_TwoStepTransfer() public {
        vm.prank(owner);
        nft.transferOwnership(user1);

        // Not yet transferred
        assertEq(nft.owner(), owner);

        // user1 must accept
        vm.prank(user1);
        nft.acceptOwnership();

        assertEq(nft.owner(), user1);
    }

    function test_Ownership_RevertsIfNotPendingOwner() public {
        vm.prank(owner);
        nft.transferOwnership(user1);

        vm.prank(attacker);
        vm.expectRevert();
        nft.acceptOwnership();
    }

    // ============ ERC2981 Royalty Tests ============

    function test_Royalty_DefaultFivePercent() public {
        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);
        (address receiver, uint256 royaltyAmount) = nft.royaltyInfo(
            tokenId,
            1000
        );
        assertEq(royaltyAmount, 50); // 5% of 1000
    }

    function test_Royalty_UpdateSuccess() public {
        vm.prank(owner);
        nft.setRoyaltyInfo(owner, 1000); // 10%

        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);
        (, uint256 royaltyAmount) = nft.royaltyInfo(tokenId, 1000);
        assertEq(royaltyAmount, 100); // 10% of 1000
    }

    function test_Royalty_RevertsAboveMax() public {
        vm.prank(owner);
        vm.expectRevert("Royalty too high (max 10%)");
        nft.setRoyaltyInfo(owner, 1001);
    }

    // ============ Fuzz Tests ============

    function testFuzz_MintPrice_RefundsExcess(uint256 overpayment) public {
        overpayment = bound(overpayment, MINT_PRICE_ETH, 100 ether);
        vm.deal(user1, overpayment + 1 ether);

        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        nft.mintWithETH{value: overpayment}(CD_KEY_HASH_1, proofForHash1);

        assertApproxEqAbs(
            user1.balance,
            balanceBefore - MINT_PRICE_ETH,
            0.001 ether
        );
    }

    function testFuzz_ClaimCDKey_RevertsWrongHash(bytes32 wrongHash) public {
        vm.assume(wrongHash != CD_KEY_HASH_1);

        uint256 tokenId = _mintToken(user1, CD_KEY_HASH_1, proofForHash1);

        vm.prank(user1);
        vm.expectRevert(SoulboundNFT.InvalidCommitmentHash.selector);
        nft.claimCdKey(tokenId, wrongHash, ENCRYPTED_KEY_1);
    }
}
