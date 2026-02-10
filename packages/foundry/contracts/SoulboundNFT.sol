// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SoulboundNFT - Game CD-Key Distribution via NFTs
 * @dev NFT with ERC20 payments, 5% royalties, and encrypted CD-key storage
 * @notice Supports ETH, USDT, and USDC payments with automatic royalties
 * @notice NFTs become soulbound (non-transferable) when CD-keys are claimed
 */
contract SoulboundNFT is ERC721, ERC2981, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    uint256 public mintPriceETH = 0.01 ether; // ETH price changes are not accounted for, for simplicity's sake
    uint256 public mintPriceUSD = 20e6; // 20 USDC/USDT (6 decimals)
    uint256 public maxSupply = 10;
    uint256 private nextTokenId = 1;

    // Supported payment tokens
    IERC20 public USDT;
    IERC20 public USDC;

    // Payment method tracking
    enum PaymentMethod {
        ETH,
        USDT,
        USDC
    }

    // CD-Key management
    mapping(uint256 => bytes32) private keyHash; // Issuer's integrity commitment (CDkey reserved)
    mapping(uint256 => bytes) private encryptedCdKey; // Owner's encrypted key
    mapping(uint256 => bool) private isClaimed; // Soulbound status
    mapping(uint256 => uint256) private claimTimestamp; // When key was claimed

    // ============ Events ============

    event NFTMinted(
        uint256 indexed tokenId,
        address indexed minter,
        PaymentMethod paymentMethod
    );
    event CdKeyClaimed(uint256 indexed tokenId, address indexed owner, bytes32 keyHash);
    event NFTBurned(uint256 indexed tokenId);
    event MintPriceUpdated(uint256 ethPrice, uint256 usdPrice);
    event MaxSupplyUpdated(uint256 oldSupply, uint256 newSupply);
    event PaymentTokensUpdated(address usdt, address usdc);
    event RoyaltyUpdated(address receiver, uint96 feeNumerator);

    // ============ Errors ============

    error InsufficientPayment();
    error MaxSupplyReached();
    error NotTokenOwner();
    error AlreadyClaimed();
    error NotClaimed();
    error CannotTransferClaimed();
    error WithdrawalFailed();
    error InvalidPaymentToken();
    error ZeroAddress();

    // ============ Constructor ============

    /**
     * @param usdtAddress USDT token contract address
     * @param usdcAddress USDC token contract address
     */
    constructor(
        address usdtAddress,
        address usdcAddress
    ) ERC721("SoulboundNFT", "SBNFT") Ownable(msg.sender) {
        if (usdtAddress == address(0) || usdcAddress == address(0))
            revert ZeroAddress();

        USDT = IERC20(usdtAddress);
        USDC = IERC20(usdcAddress);

        // Set 5% royalty to this contract
        _setDefaultRoyalty(address(this), 500); // 500 basis points = 5%
    }

    // ============ Minting Functions ============

    /**
     * @notice Mint NFT paying with ETH
     */
    function mintWithETH(
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < mintPriceETH) revert InsufficientPayment();
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        uint256 tokenId = _mintNFT(msg.sender);

        // Refund excess
        if (msg.value > mintPriceETH) {
            (bool refundSuccess, ) = payable(msg.sender).call{
                value: msg.value - mintPriceETH
            }("");
            require(refundSuccess, "Refund failed");
        }

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.ETH);
    }

    /**
     * @notice Mint NFT paying with USDT
     */
    function mintWithUSDT(
    ) external whenNotPaused nonReentrant {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        USDT.safeTransferFrom(msg.sender, address(this), mintPriceUSD);

        uint256 tokenId = _mintNFT(msg.sender);

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.USDT);
    }

    /**
     * @notice Mint NFT paying with USDC
     */
    function mintWithUSDC(
    ) external whenNotPaused nonReentrant {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        USDC.safeTransferFrom(msg.sender, address(this), mintPriceUSD);

        uint256 tokenId = _mintNFT(msg.sender);

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.USDC);
    }

    // ============ Combined Mint & Claim Functions ============

    /**
     * @notice Mint NFT with ETH and immediately claim CD-key (becomes soulbound)
     * @param cdKeyHash keccak256(abi.encodePacked(plainTextCdKey))
     * @param ownerEncryptedKey CD-key encrypted with owner's public key
     */
    function mintAndClaimWithETH(
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < mintPriceETH) revert InsufficientPayment();
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        uint256 tokenId = _mintNFT(msg.sender);

        // Immediately claim and make soulbound
        keyHash[tokenId] = cdKeyHash;
        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        // Refund excess
        if (msg.value > mintPriceETH) {
            (bool refundSuccess, ) = payable(msg.sender).call{
                value: msg.value - mintPriceETH
            }("");
            require(refundSuccess, "Refund failed");
        }

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.ETH);
        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    /**
     * @notice Mint NFT with USDT and immediately claim CD-key (becomes soulbound)
     * @param cdKeyHash keccak256(abi.encodePacked(plainTextCdKey))
     * @param ownerEncryptedKey CD-key encrypted with owner's public key
     */
    function mintAndClaimWithUSDT(
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external whenNotPaused nonReentrant {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        USDT.safeTransferFrom(msg.sender, address(this), mintPriceUSD);

        uint256 tokenId = _mintNFT(msg.sender);

        // Immediately claim and make soulbound
        keyHash[tokenId] = cdKeyHash;
        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.USDT);
        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    /**
     * @notice Mint NFT with USDC and immediately claim CD-key (becomes soulbound)
     * @param cdKeyHash keccak256(abi.encodePacked(plainTextCdKey))
     * @param ownerEncryptedKey CD-key encrypted with owner's public key
     */
    function mintAndClaimWithUSDC(
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external whenNotPaused nonReentrant {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();

        USDC.safeTransferFrom(msg.sender, address(this), mintPriceUSD);

        uint256 tokenId = _mintNFT(msg.sender);

        // Immediately claim and make soulbound
        keyHash[tokenId] = cdKeyHash;
        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        emit NFTMinted(tokenId, msg.sender, PaymentMethod.USDC);
        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    /**
     * @dev Internal mint function
     */
    function _mintNFT(address to) private returns (uint256) {
        uint256 tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    // ============ CD-Key Claim Management ============

    /**
     * @notice Claim the CD-key and make NFT soulbound
     * @dev Stores encrypted key on-chain and locks transfers permanently
     * @param tokenId The token ID
     * @param cdKeyHash keccak256(abi.encodePacked(plainTextCdKey))
     * @param ownerEncryptedKey CD-key encrypted with owner's public key (for off-chain reveal)
     */
    function claimCdKey(
        uint256 tokenId,
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (isClaimed[tokenId]) revert AlreadyClaimed();

        // Store encrypted key and mark as claimed (soulbound)
        keyHash[tokenId] = cdKeyHash;
        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    /**
     * @notice Retrieve the encrypted CD-key from blockchain
     * @dev Owner decrypts off-chain to reveal the plaintext key
     * @param tokenId The token ID
     * @return The encrypted CD-key
     */
    function getCdKey(uint256 tokenId) external view returns (bytes memory) {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!isClaimed[tokenId]) revert NotClaimed();

        return encryptedCdKey[tokenId];
    }

    /**
     * @notice Get the hash of the CD-key (issuer's integrity commitment)
     * @dev Used for off-chain verification that decrypted key is correct
     * @param tokenId The token ID
     * @return The keccak256 hash
     */
    function getKeyHash(uint256 tokenId) external view returns (bytes32) {
        return keyHash[tokenId];
    }

    /**
     * @notice Check if a token is claimed (soulbound)
     * @param tokenId The token ID
     * @return True if claimed
     */
    function isClaimedToken(uint256 tokenId) external view returns (bool) {
        return isClaimed[tokenId];
    }

    /**
     * @notice Get claim timestamp
     * @param tokenId The token ID
     * @return Unix timestamp when key was claimed
     */
    function getClaimTimestamp(
        uint256 tokenId
    ) external view returns (uint256) {
        return claimTimestamp[tokenId];
    }

    /**
     * @notice Burn NFT and delete all associated data
     * @param tokenId The token ID
     */
    function deleteNft(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        _burn(tokenId);
        delete keyHash[tokenId];
        delete encryptedCdKey[tokenId];
        delete isClaimed[tokenId];
        delete claimTimestamp[tokenId];

        emit NFTBurned(tokenId);
    }

    // ============ Transfer Override ============

    /**
     * @dev Override to prevent transferring claimed NFTs (soulbound enforcement)
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Block transfers of claimed NFTs (except minting and burning)
        if (from != address(0) && to != address(0)) {
            if (isClaimed[tokenId]) revert CannotTransferClaimed();
        }

        return super._update(to, tokenId, auth);
    }

    // ============ Royalty Functions (ERC-2981) ============

    /**
     * @notice Update royalty receiver and percentage
     * @param receiver Address to receive royalties
     * @param feeNumerator Royalty percentage in basis points (500 = 5%)
     */
    function setRoyaltyInfo(
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        require(feeNumerator <= 1000, "Royalty too high (max 10%)");

        _setDefaultRoyalty(receiver, feeNumerator);

        emit RoyaltyUpdated(receiver, feeNumerator);
    }

    /**
     * @dev Override supportsInterface for ERC-2981
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update mint prices
     * @param ethPrice Price in ETH (wei)
     * @param usdPrice Price in USD (with 6 decimals for USDT/USDC)
     */
    function setMintPrices(
        uint256 ethPrice,
        uint256 usdPrice
    ) external onlyOwner {
        mintPriceETH = ethPrice;
        mintPriceUSD = usdPrice;
        emit MintPriceUpdated(ethPrice, usdPrice);
    }

    /**
     * @notice Update payment token addresses
     * @param usdtAddress New USDT address
     * @param usdcAddress New USDC address
     */
    function setPaymentTokens(
        address usdtAddress,
        address usdcAddress
    ) external onlyOwner {
        if (usdtAddress == address(0) || usdcAddress == address(0))
            revert ZeroAddress();

        USDT = IERC20(usdtAddress);
        USDC = IERC20(usdcAddress);

        emit PaymentTokensUpdated(usdtAddress, usdcAddress);
    }

    /**
     * @notice Update maximum supply
     * @param newMaxSupply New max supply
     */
    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(
            newMaxSupply >= nextTokenId - 1,
            "Cannot set below current supply"
        );
        uint256 oldSupply = maxSupply;
        maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(oldSupply, newMaxSupply);
    }

    /**
     * @notice Pause minting
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause minting
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw ETH from contract
     */
    function withdrawETH() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert WithdrawalFailed();
    }

    /**
     * @notice Withdraw USDT from contract
     */
    function withdrawUSDT() external onlyOwner nonReentrant {
        uint256 balance = USDT.balanceOf(address(this));
        USDT.safeTransfer(owner(), balance);
    }

    /**
     * @notice Withdraw USDC from contract
     */
    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 balance = USDC.balanceOf(address(this));
        USDC.safeTransfer(owner(), balance);
    }

    /**
     * @notice Withdraw all funds (ETH, USDT, USDC)
     */
    function withdrawAll() external onlyOwner nonReentrant {
        // Withdraw ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool success, ) = payable(owner()).call{value: ethBalance}("");
            if (!success) revert WithdrawalFailed();
        }

        // Withdraw USDT
        uint256 usdtBalance = USDT.balanceOf(address(this));
        if (usdtBalance > 0) {
            USDT.safeTransfer(owner(), usdtBalance);
        }

        // Withdraw USDC
        uint256 usdcBalance = USDC.balanceOf(address(this));
        if (usdcBalance > 0) {
            USDC.safeTransfer(owner(), usdcBalance);
        }
    }

    /**
     * @notice Emergency token withdrawal (for any ERC20)
     * @param token Token contract address
     */
    function emergencyWithdrawToken(
        address token
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        tokenContract.safeTransfer(owner(), balance);
    }

    /**
     * @notice Get total supply
     * @return Current total supply
     */
    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1;
    }

    /**
     * @notice Receive function to accept ETH royalty payments
     */
    receive() external payable {}
}