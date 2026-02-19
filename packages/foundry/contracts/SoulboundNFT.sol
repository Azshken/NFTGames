// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SoulboundNFT - Game CD-Key Distribution via NFTs
 * @dev NFT with ERC20 payments, 5% royalties, and encrypted CD-key storage
 * @notice Supports ETH, USDT, and USDC payments
 * @notice NFTs become soulbound (non-transferable) when CD-keys are claimed
 * @notice Commitment hash verified at claim time against what was stored at mint
 */
contract SoulboundNFT is ERC721, ERC2981, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ============ State Variables ============

    // Prices — Chainlink feed integration planned for production
    uint128 public mintPriceETH = 0.01 ether;
    uint128 public mintPriceUSD = 20e6;
    uint64 public maxSupply = 10;
    uint64 private nextTokenId = 1;

    string private _baseTokenURI;

    IERC20 public USDT;
    IERC20 public USDC;

    mapping(uint256 => bytes32) private commitmentHash;
    mapping(uint256 => bytes) private encryptedCdKey;
    mapping(uint256 => bool) private isClaimed;
    mapping(uint256 => uint256) private claimTimestamp;

    uint256 private _burnedCount;

    // ============ Events ============

    event NFTMinted(
        uint256 indexed tokenId,
        address indexed minter,
        address indexed paymentToken,
        bytes32 commitmentHash
    );
    event CdKeyClaimed(uint256 indexed tokenId, address indexed owner, bytes32 commitmentHash);
    event NFTBurned(uint256 indexed tokenId, address indexed owner, bool wasSoulbound);
    event MintPriceUpdated(uint256 ethPrice, uint256 usdPrice);
    event MaxSupplyUpdated(uint256 oldSupply, uint256 newSupply);
    event PaymentTokensUpdated(address usdt, address usdc);
    event RoyaltyUpdated(address receiver, uint96 feeNumerator);
    event BaseURIUpdated(string newBaseURI);

    // ============ Errors ============

    error InsufficientPayment();
    error MaxSupplyReached();
    error NotTokenOwner();
    error AlreadyClaimed();
    error NotClaimed();
    error CannotTransferClaimed();
    error WithdrawalFailed();
    error ZeroAddress();
    error InvalidCommitmentHash();

    // ============ Constructor ============

    constructor(
        address usdtAddress,
        address usdcAddress,
        string memory baseTokenURI
    ) ERC721("Fallout", "FALL") Ownable(msg.sender) {
        if (usdtAddress == address(0) || usdcAddress == address(0))
            revert ZeroAddress();

        USDT = IERC20(usdtAddress);
        USDC = IERC20(usdcAddress);
        _baseTokenURI = baseTokenURI;

        _setDefaultRoyalty(address(this), 500);
    }

    // ============ Metadata ============

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _baseTokenURI;
    }

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    // ============ Minting ============

    /**
     * @notice Mint NFT with ETH
     * @param cdCommitmentHash Hash of the CD key reserved from backend
     */
    function mintWithETH(
        bytes32 cdCommitmentHash
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < mintPriceETH) revert InsufficientPayment();
        _validateCommitment(cdCommitmentHash);
        uint256 tokenId = _mintNFT(msg.sender, cdCommitmentHash);

        if (msg.value > mintPriceETH) {
            (bool refundSuccess, ) = payable(msg.sender).call{
                value: msg.value - mintPriceETH
            }("");
            require(refundSuccess, "Refund failed");
        }

        emit NFTMinted(tokenId, msg.sender, address(0), cdCommitmentHash);
    }

    /**
     * @notice Mint NFT with USDT
     * @param cdCommitmentHash Hash of the CD key reserved from backend
     */
    function mintWithUSDT(
        bytes32 cdCommitmentHash
    ) external whenNotPaused nonReentrant {
        _validateCommitment(cdCommitmentHash);
        USDT.safeTransferFrom(msg.sender, address(this), mintPriceUSD);
        uint256 tokenId = _mintNFT(msg.sender, cdCommitmentHash);

        emit NFTMinted(tokenId, msg.sender, address(USDT), cdCommitmentHash);
    }

    /**
     * @notice Mint NFT with USDC
     * @param cdCommitmentHash Hash of the CD key reserved from backend
     */
    function mintWithUSDC(
        bytes32 cdCommitmentHash
    ) external whenNotPaused nonReentrant {
        _validateCommitment(cdCommitmentHash);
        USDC.safeTransferFrom(msg.sender, address(this), mintPriceUSD);
        uint256 tokenId = _mintNFT(msg.sender, cdCommitmentHash);

        emit NFTMinted(tokenId, msg.sender, address(USDC), cdCommitmentHash);
    }

    function _validateCommitment(bytes32 cdCommitmentHash) private view {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();
        if (cdCommitmentHash == bytes32(0)) revert InvalidCommitmentHash();
    }

    function _mintNFT(address to, bytes32 cdCommitmentHash) private returns (uint256) {
        uint256 tokenId = nextTokenId++;
        commitmentHash[tokenId] = cdCommitmentHash;
        _safeMint(to, tokenId);
        return tokenId;
    }

    // ============ CD-Key Claim ============

    /**
     * @notice Claim CD key and make NFT soulbound
     * @dev cdKeyHash must match commitment stored at mint time
     * @param tokenId The token ID
     * @param cdKeyHash Must match the commitmentHash stored at mint
     * @param ownerEncryptedKey CD key encrypted with owner's MetaMask public key
     */
    function claimCdKey(
        uint256 tokenId,
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (isClaimed[tokenId]) revert AlreadyClaimed();
        if (commitmentHash[tokenId] != cdKeyHash) revert InvalidCommitmentHash();

        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    /**
     * @notice Retrieve encrypted CD key — only callable by token owner
     * @param tokenId The token ID
     */
    function getEncryptedCDKey(uint256 tokenId) external view returns (bytes memory) {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!isClaimed[tokenId]) revert NotClaimed();
        return encryptedCdKey[tokenId];
    }

    function getCommitmentHash(uint256 tokenId) external view returns (bytes32) {
        return commitmentHash[tokenId];
    }

    function isClaimedToken(uint256 tokenId) external view returns (bool) {
        return isClaimed[tokenId];
    }

    function getClaimTimestamp(uint256 tokenId) external view returns (uint256) {
        return claimTimestamp[tokenId];
    }

    // ============ Burn ============

    /**
     * @notice Burn NFT for game library management
     * @dev Soulbound NFTs are intentionally burnable
     */
    function burn(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        bool wasSoulbound = isClaimed[tokenId];
        _burnedCount++;

        _burn(tokenId);
        delete commitmentHash[tokenId];
        delete encryptedCdKey[tokenId];
        delete isClaimed[tokenId];
        delete claimTimestamp[tokenId];

        emit NFTBurned(tokenId, msg.sender, wasSoulbound);
    }

    // ============ Transfer Override ============

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            if (isClaimed[tokenId]) revert CannotTransferClaimed();
        }
        return super._update(to, tokenId, auth);
    }

    // ============ Royalty ============

    function setRoyaltyInfo(address receiver, uint96 feeNumerator) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        require(feeNumerator <= 1000, "Royalty too high (max 10%)");
        _setDefaultRoyalty(receiver, feeNumerator);
        emit RoyaltyUpdated(receiver, feeNumerator);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ============ Admin ============

    function setMintPrices(uint256 ethPrice, uint256 usdPrice) external onlyOwner {
        mintPriceETH = uint128(ethPrice);
        mintPriceUSD = uint128(usdPrice);
        emit MintPriceUpdated(ethPrice, usdPrice);
    }

    function setPaymentTokens(address usdtAddress, address usdcAddress) external onlyOwner {
        if (usdtAddress == address(0) || usdcAddress == address(0)) revert ZeroAddress();
        USDT = IERC20(usdtAddress);
        USDC = IERC20(usdcAddress);
        emit PaymentTokensUpdated(usdtAddress, usdcAddress);
    }

    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(newMaxSupply >= nextTokenId - 1, "Cannot set below current supply");
        uint256 oldSupply = maxSupply;
        maxSupply = uint64(newMaxSupply);
        emit MaxSupplyUpdated(oldSupply, newMaxSupply);
    }

    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1 - _burnedCount;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawETH() external onlyOwner nonReentrant {
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        if (!success) revert WithdrawalFailed();
    }

    function withdrawUSDT() external onlyOwner nonReentrant {
        USDT.safeTransfer(owner(), USDT.balanceOf(address(this)));
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        USDC.safeTransfer(owner(), USDC.balanceOf(address(this)));
    }

    function withdrawAll() external onlyOwner nonReentrant {
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool success, ) = payable(owner()).call{value: ethBalance}("");
            if (!success) revert WithdrawalFailed();
        }
        uint256 usdtBalance = USDT.balanceOf(address(this));
        if (usdtBalance > 0) USDT.safeTransfer(owner(), usdtBalance);
        uint256 usdcBalance = USDC.balanceOf(address(this));
        if (usdcBalance > 0) USDC.safeTransfer(owner(), usdcBalance);
    }

    function emergencyWithdrawToken(address token) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        IERC20 t = IERC20(token);
        t.safeTransfer(owner(), t.balanceOf(address(this)));
    }

    receive() external payable {}
}
