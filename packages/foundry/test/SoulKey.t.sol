// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {SoulKey} from "../contracts/SoulKey.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

// ============ Mock ERC20 ============

contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(
        string memory name,
        string memory symbol,
        uint8 dec
    ) ERC20(name, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ============ Main Test Contract ============

contract SoulKeyTest is Test {
    // ---- Contracts ----
    SoulKey public soulKey;
    MockERC20 public usdt;
    MockERC20 public usdc;

    // ---- Actors ----
    address public owner = address(this);
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    // ---- Constants ----
    bytes32 public constant COMMITMENT = keccak256("game-cd-key-1");
    bytes32 public constant COMMITMENT_2 = keccak256("game-cd-key-2");
    bytes public constant ENCRYPTED_KEY = hex"deadbeef";
    string public constant BASE_URI = "https://api.soulkey.io/metadata/1";
    uint256 public constant MINT_ETH = 0.01 ether;
    uint256 public constant MINT_USD = 20e6;

    // ============ Setup ============

    function setUp() public {
        usdt = new MockERC20("Tether USD", "USDT", 6);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        soulKey = new SoulKey(address(usdt), address(usdc), BASE_URI);

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        usdt.mint(alice, 1_000e6);
        usdc.mint(alice, 1_000e6);
        usdt.mint(bob, 1_000e6);
        usdc.mint(bob, 1_000e6);
    }

    // ============ Helpers ============

    function _mintETH(
        address user,
        bytes32 commitment
    ) internal returns (uint256 tokenId) {
        vm.prank(user);
        soulKey.mintWithETH{value: MINT_ETH}(commitment);
        tokenId = soulKey.totalSupply();
    }

    function _claim(
        address user,
        uint256 tokenId,
        bytes32 commitment
    ) internal {
        vm.prank(user);
        soulKey.claimCdKey(tokenId, commitment, ENCRYPTED_KEY);
    }

    // ============ Constructor ============

    function test_Constructor_SetsTokenAddresses() public view {
        assertEq(address(soulKey.USDT()), address(usdt));
        assertEq(address(soulKey.USDC()), address(usdc));
    }

    function test_Constructor_SetsName() public view {
        assertEq(soulKey.name(), "Fallout");
        assertEq(soulKey.symbol(), "FALL");
    }

    function test_Constructor_SetsRoyalty() public view {
        (address receiver, uint256 amount) = soulKey.royaltyInfo(1, 10_000);
        assertEq(receiver, address(soulKey));
        assertEq(amount, 500); // 5%
    }

    function test_Constructor_RevertZeroUSDT() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        new SoulKey(address(0), address(usdc), BASE_URI);
    }

    function test_Constructor_RevertZeroUSDC() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        new SoulKey(address(usdt), address(0), BASE_URI);
    }

    // ============ mintWithETH ============

    function test_MintWithETH_Success() public {
        vm.prank(alice);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);

        assertEq(soulKey.ownerOf(1), alice);
        assertEq(soulKey.totalSupply(), 1);
        assertEq(soulKey.getCommitmentHash(1), COMMITMENT);
    }

    function test_MintWithETH_EmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit SoulKey.NFTMinted(1, alice, address(0), COMMITMENT);

        vm.prank(alice);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);
    }

    function test_MintWithETH_RefundsExcess() public {
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        soulKey.mintWithETH{value: 1 ether}(COMMITMENT);

        assertApproxEqAbs(alice.balance, balanceBefore - MINT_ETH, 1e15); // allow gas
    }

    function test_MintWithETH_RevertInsufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(SoulKey.InsufficientPayment.selector);
        soulKey.mintWithETH{value: MINT_ETH - 1}(COMMITMENT);
    }

    function test_MintWithETH_RevertZeroCommitment() public {
        vm.prank(alice);
        vm.expectRevert(SoulKey.InvalidCommitmentHash.selector);
        soulKey.mintWithETH{value: MINT_ETH}(bytes32(0));
    }

    function test_MintWithETH_RevertMaxSupply() public {
        for (uint256 i = 1; i <= 10; i++) {
            bytes32 commitment = keccak256(abi.encodePacked("key", i));
            vm.prank(alice);
            soulKey.mintWithETH{value: MINT_ETH}(commitment);
        }
        vm.prank(alice);
        vm.expectRevert(SoulKey.MaxSupplyReached.selector);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);
    }

    function test_MintWithETH_RevertWhenPaused() public {
        soulKey.pause();
        vm.prank(alice);
        vm.expectRevert();
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);
    }

    function testFuzz_MintWithETH_RefundsExcessCorrectly(uint96 extra) public {
        uint256 maxExtra = alice.balance - MINT_ETH;
        uint256 boundedExtra = bound(uint256(extra), 1, maxExtra);
        uint256 payment = MINT_ETH + boundedExtra;
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        soulKey.mintWithETH{value: payment}(COMMITMENT);

        assertApproxEqAbs(alice.balance, balanceBefore - MINT_ETH, 1e15);
    }

    // ============ mintWithUSDT ============

    function test_MintWithUSDT_Success() public {
        vm.startPrank(alice);
        usdt.approve(address(soulKey), MINT_USD);
        soulKey.mintWithUSDT(COMMITMENT);
        vm.stopPrank();

        assertEq(soulKey.ownerOf(1), alice);
        assertEq(usdt.balanceOf(address(soulKey)), MINT_USD);
    }

    function test_MintWithUSDT_EmitsEvent() public {
        vm.startPrank(alice);
        usdt.approve(address(soulKey), MINT_USD);

        vm.expectEmit(true, true, true, true);
        emit SoulKey.NFTMinted(1, alice, address(usdt), COMMITMENT);
        soulKey.mintWithUSDT(COMMITMENT);
        vm.stopPrank();
    }

    function test_MintWithUSDT_RevertNoAllowance() public {
        vm.prank(alice);
        vm.expectRevert();
        soulKey.mintWithUSDT(COMMITMENT);
    }

    function test_MintWithUSDT_RevertWhenPaused() public {
        soulKey.pause();
        vm.startPrank(alice);
        usdt.approve(address(soulKey), MINT_USD);
        vm.expectRevert();
        soulKey.mintWithUSDT(COMMITMENT);
        vm.stopPrank();
    }

    // ============ mintWithUSDC ============

    function test_MintWithUSDC_Success() public {
        vm.startPrank(alice);
        usdc.approve(address(soulKey), MINT_USD);
        soulKey.mintWithUSDC(COMMITMENT);
        vm.stopPrank();

        assertEq(soulKey.ownerOf(1), alice);
        assertEq(usdc.balanceOf(address(soulKey)), MINT_USD);
    }

    function test_MintWithUSDC_EmitsEvent() public {
        vm.startPrank(alice);
        usdc.approve(address(soulKey), MINT_USD);

        vm.expectEmit(true, true, true, true);
        emit SoulKey.NFTMinted(1, alice, address(usdc), COMMITMENT);
        soulKey.mintWithUSDC(COMMITMENT);
        vm.stopPrank();
    }

    function test_MintWithUSDC_RevertNoAllowance() public {
        vm.prank(alice);
        vm.expectRevert();
        soulKey.mintWithUSDC(COMMITMENT);
    }

    // ============ claimCdKey ============

    function test_ClaimCdKey_Success() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(alice);
        soulKey.claimCdKey(1, COMMITMENT, ENCRYPTED_KEY);

        assertTrue(soulKey.isClaimedToken(1));
        assertGt(soulKey.getClaimTimestamp(1), 0);
    }

    function test_ClaimCdKey_StoresEncryptedKey() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(alice);
        assertEq(soulKey.getEncryptedCDKey(1), ENCRYPTED_KEY);
    }

    function test_ClaimCdKey_SetsClaimTimestamp() public {
        _mintETH(alice, COMMITMENT);

        vm.warp(1_000_000);
        _claim(alice, 1, COMMITMENT);

        assertEq(soulKey.getClaimTimestamp(1), 1_000_000);
    }

    function test_ClaimCdKey_EmitsEvent() public {
        _mintETH(alice, COMMITMENT);

        vm.expectEmit(true, true, false, true);
        emit SoulKey.CdKeyClaimed(1, alice, COMMITMENT);

        _claim(alice, 1, COMMITMENT);
    }

    function test_ClaimCdKey_RevertNotOwner() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(bob);
        vm.expectRevert(SoulKey.NotTokenOwner.selector);
        soulKey.claimCdKey(1, COMMITMENT, ENCRYPTED_KEY);
    }

    function test_ClaimCdKey_RevertAlreadyClaimed() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(alice);
        vm.expectRevert(SoulKey.AlreadyClaimed.selector);
        soulKey.claimCdKey(1, COMMITMENT, ENCRYPTED_KEY);
    }

    function test_ClaimCdKey_RevertWrongCommitment() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(alice);
        vm.expectRevert(SoulKey.InvalidCommitmentHash.selector);
        soulKey.claimCdKey(1, keccak256("wrong-key"), ENCRYPTED_KEY);
    }

    // ============ getEncryptedCDKey ============

    function test_GetEncryptedCDKey_RevertNotOwner() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(bob);
        vm.expectRevert(SoulKey.NotTokenOwner.selector);
        soulKey.getEncryptedCDKey(1);
    }

    function test_GetEncryptedCDKey_RevertNotClaimed() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(alice);
        vm.expectRevert(SoulKey.NotClaimed.selector);
        soulKey.getEncryptedCDKey(1);
    }

    // ============ Soulbound Transfer ============

    function test_Transfer_BeforeClaim_Succeeds() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(alice);
        soulKey.transferFrom(alice, bob, 1);

        assertEq(soulKey.ownerOf(1), bob);
    }

    function test_Transfer_AfterClaim_Reverts() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(alice);
        vm.expectRevert(SoulKey.CannotTransferClaimed.selector);
        soulKey.transferFrom(alice, bob, 1);
    }

    function test_SafeTransfer_AfterClaim_Reverts() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(alice);
        vm.expectRevert(SoulKey.CannotTransferClaimed.selector);
        soulKey.safeTransferFrom(alice, bob, 1);
    }

    // ============ Burn ============

    function test_Burn_Success() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(alice);
        soulKey.burn(1);

        vm.expectRevert();
        soulKey.ownerOf(1);
    }

    function test_Burn_SoulboundToken() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.expectEmit(true, true, false, true);
        emit SoulKey.NFTBurned(1, alice, true);

        vm.prank(alice);
        soulKey.burn(1);
    }

    function test_Burn_ClearsCommitmentHash() public {
        _mintETH(alice, COMMITMENT);
        vm.prank(alice);
        soulKey.burn(1);

        assertEq(soulKey.getCommitmentHash(1), bytes32(0));
    }

    function test_Burn_ClearsClaimData() public {
        _mintETH(alice, COMMITMENT);
        _claim(alice, 1, COMMITMENT);

        vm.prank(alice);
        soulKey.burn(1);

        assertFalse(soulKey.isClaimedToken(1));
        assertEq(soulKey.getClaimTimestamp(1), 0);
    }

    function test_Burn_UpdatesTotalSupply() public {
        _mintETH(alice, COMMITMENT);
        assertEq(soulKey.totalSupply(), 1);

        vm.prank(alice);
        soulKey.burn(1);
        assertEq(soulKey.totalSupply(), 0);
    }

    function test_Burn_RevertNotOwner() public {
        _mintETH(alice, COMMITMENT);

        vm.prank(bob);
        vm.expectRevert(SoulKey.NotTokenOwner.selector);
        soulKey.burn(1);
    }

    // ============ Admin: setMintPrices ============

    function test_SetMintPrices() public {
        soulKey.setMintPrices(0.02 ether, 40e6);
        assertEq(soulKey.mintPriceETH(), 0.02 ether);
        assertEq(soulKey.mintPriceUSD(), 40e6);
    }

    function test_SetMintPrices_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit SoulKey.MintPriceUpdated(0.02 ether, 40e6);
        soulKey.setMintPrices(0.02 ether, 40e6);
    }

    function test_SetMintPrices_RevertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        soulKey.setMintPrices(0.02 ether, 40e6);
    }

    // ============ Admin: setMaxSupply ============

    function test_SetMaxSupply() public {
        soulKey.setMaxSupply(20);
        assertEq(soulKey.maxSupply(), 20);
    }

    function test_SetMaxSupply_RevertBelowCurrentSupply() public {
        _mintETH(alice, COMMITMENT);
        _mintETH(alice, COMMITMENT_2);

        vm.expectRevert("Cannot set below current supply");
        soulKey.setMaxSupply(1);
    }

    function test_SetMaxSupply_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit SoulKey.MaxSupplyUpdated(10, 20);
        soulKey.setMaxSupply(20);
    }

    // ============ Admin: setPaymentTokens ============

    function test_SetPaymentTokens() public {
        MockERC20 newUsdt = new MockERC20("New USDT", "USDT2", 6);
        MockERC20 newUsdc = new MockERC20("New USDC", "USDC2", 6);
        soulKey.setPaymentTokens(address(newUsdt), address(newUsdc));
        assertEq(address(soulKey.USDT()), address(newUsdt));
        assertEq(address(soulKey.USDC()), address(newUsdc));
    }

    function test_SetPaymentTokens_RevertZeroUSDT() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        soulKey.setPaymentTokens(address(0), address(usdc));
    }

    function test_SetPaymentTokens_RevertZeroUSDC() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        soulKey.setPaymentTokens(address(usdt), address(0));
    }

    // ============ Admin: setRoyaltyInfo ============

    function test_SetRoyaltyInfo() public {
        soulKey.setRoyaltyInfo(alice, 1000);
        (address receiver, uint256 amount) = soulKey.royaltyInfo(1, 10_000);
        assertEq(receiver, alice);
        assertEq(amount, 1000);
    }

    function test_SetRoyaltyInfo_RevertZeroAddress() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        soulKey.setRoyaltyInfo(address(0), 500);
    }

    function test_SetRoyaltyInfo_RevertTooHigh() public {
        vm.expectRevert("Royalty too high (max 10%)");
        soulKey.setRoyaltyInfo(alice, 1001);
    }

    // ============ Admin: pause / unpause ============

    function test_Pause_BlocksMinting() public {
        soulKey.pause();
        vm.prank(alice);
        vm.expectRevert();
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);
    }

    function test_Unpause_AllowsMinting() public {
        soulKey.pause();
        soulKey.unpause();
        vm.prank(alice);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);
        assertEq(soulKey.ownerOf(1), alice);
    }

    function test_Pause_RevertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        soulKey.pause();
    }

    // ============ Admin: withdrawETH ============

    function test_WithdrawETH() public {
        vm.prank(alice);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);

        uint256 balanceBefore = owner.balance;
        soulKey.withdrawETH();
        assertEq(owner.balance, balanceBefore + MINT_ETH);
    }

    function test_WithdrawETH_RevertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        soulKey.withdrawETH();
    }

    // ============ Admin: withdrawUSDT ============

    function test_WithdrawUSDT() public {
        vm.startPrank(alice);
        usdt.approve(address(soulKey), MINT_USD);
        soulKey.mintWithUSDT(COMMITMENT);
        vm.stopPrank();

        uint256 balanceBefore = usdt.balanceOf(owner);
        soulKey.withdrawUSDT();
        assertEq(usdt.balanceOf(owner), balanceBefore + MINT_USD);
    }

    // ============ Admin: withdrawUSDC ============

    function test_WithdrawUSDC() public {
        vm.startPrank(alice);
        usdc.approve(address(soulKey), MINT_USD);
        soulKey.mintWithUSDC(COMMITMENT);
        vm.stopPrank();

        uint256 balanceBefore = usdc.balanceOf(owner);
        soulKey.withdrawUSDC();
        assertEq(usdc.balanceOf(owner), balanceBefore + MINT_USD);
    }

    // ============ Admin: withdrawAll ============

    function test_WithdrawAll() public {
        vm.prank(alice);
        soulKey.mintWithETH{value: MINT_ETH}(COMMITMENT);

        vm.startPrank(alice);
        usdt.approve(address(soulKey), MINT_USD);
        soulKey.mintWithUSDT(COMMITMENT_2);
        vm.stopPrank();

        uint256 ethBefore = owner.balance;
        uint256 usdtBefore = usdt.balanceOf(owner);
        soulKey.withdrawAll();

        assertEq(owner.balance, ethBefore + MINT_ETH);
        assertEq(usdt.balanceOf(owner), usdtBefore + MINT_USD);
    }

    // ============ Admin: emergencyWithdrawToken ============

    function test_EmergencyWithdrawToken() public {
        usdt.mint(address(soulKey), 500e6);

        uint256 balanceBefore = usdt.balanceOf(owner);
        soulKey.emergencyWithdrawToken(address(usdt));
        assertEq(usdt.balanceOf(owner), balanceBefore + 500e6);
    }

    function test_EmergencyWithdrawToken_RevertZeroAddress() public {
        vm.expectRevert(SoulKey.ZeroAddress.selector);
        soulKey.emergencyWithdrawToken(address(0));
    }

    // ============ tokenURI / baseURI ============

    function test_TokenURI_ReturnsBaseURI() public {
        _mintETH(alice, COMMITMENT);
        assertEq(soulKey.tokenURI(1), BASE_URI);
    }

    function test_TokenURI_RevertNonExistentToken() public {
        vm.expectRevert();
        soulKey.tokenURI(999);
    }

    function test_SetBaseURI() public {
        string memory newURI = "https://new.soulkey.io/metadata/";
        soulKey.setBaseURI(newURI);
        _mintETH(alice, COMMITMENT);
        assertEq(soulKey.tokenURI(1), newURI);
    }

    function test_SetBaseURI_EmitsEvent() public {
        string memory newURI = "https://new.soulkey.io/metadata/";
        vm.expectEmit(false, false, false, true);
        emit SoulKey.BaseURIUpdated(newURI);
        soulKey.setBaseURI(newURI);
    }

    // ============ supportsInterface ============

    function test_SupportsInterface_ERC721() public view {
        assertTrue(soulKey.supportsInterface(type(IERC721).interfaceId));
    }

    function test_SupportsInterface_ERC2981() public view {
        assertTrue(soulKey.supportsInterface(type(IERC2981).interfaceId));
    }

    // ============ totalSupply ============

    function test_TotalSupply_AfterMultipleMints() public {
        _mintETH(alice, COMMITMENT);
        _mintETH(alice, COMMITMENT_2);
        assertEq(soulKey.totalSupply(), 2);
    }

    function test_TotalSupply_AfterBurn() public {
        _mintETH(alice, COMMITMENT);
        _mintETH(alice, COMMITMENT_2);
        vm.prank(alice);
        soulKey.burn(1);
        assertEq(soulKey.totalSupply(), 1);
    }

    // ============ Ownable2Step ============

    function test_TransferOwnership_TwoStep() public {
        soulKey.transferOwnership(alice);
        // Still the old owner until accepted
        assertEq(soulKey.owner(), owner);

        vm.prank(alice);
        soulKey.acceptOwnership();
        assertEq(soulKey.owner(), alice);
    }

    receive() external payable {}
}
