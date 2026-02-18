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
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SoulboundNFT - Game CD-Key Distribution via NFTs
 * @dev NFT with ERC20 payments, 5% royalties, and encrypted CD-key storage
 * @notice Supports ETH, USDT, and USDC payments
 * @notice NFTs become soulbound (non-transferable) when CD-keys are claimed
 * @notice Commitment hashes verified via Merkle proof at mint time
 */
contract SoulboundNFT is
    ERC721,
    ERC2981,
    Ownable2Step,
    ReentrancyGuard,
    Pausable
{
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ============ State Variables ============

    // Prices — Chainlink feed integration planned for production
    uint128 public mintPriceETH = 0.01 ether;
    uint128 public mintPriceUSD = 20e6; // 20 USDC/USDT (6 decimals)
    uint64 public maxSupply = 10;
    uint64 private nextTokenId = 1;

    // Merkle root of all valid commitment hashes
    bytes32 public merkleRoot;

    // Static metadata URI
    string private _baseTokenURI;

    // Supported payment tokens
    IERC20 public USDT;
    IERC20 public USDC;

    // CD-Key management
    mapping(uint256 => bytes32) private commitmentHash; // Set at mint time
    mapping(uint256 => bytes) private encryptedCdKey; // Set at claim time
    mapping(uint256 => bool) private isClaimed;
    mapping(uint256 => uint256) private claimTimestamp;

    // Prevent same commitment hash from being used twice
    mapping(bytes32 => bool) public usedCommitmentHashes;

    // Burned token counter for accurate totalSupply
    uint256 private _burnedCount;

    // ============ Events ============

    event NFTMinted(
        uint256 indexed tokenId,
        address indexed minter,
        address indexed paymentToken,
        bytes32 commitmentHash
    );
    event CdKeyClaimed(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 commitmentHash
    );
    event NFTBurned(
        uint256 indexed tokenId,
        address indexed owner,
        bool wasSoulbound
    );
    event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);
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
    error CommitmentHashAlreadyUsed();
    error MerkleRootNotSet();

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

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _baseTokenURI;
    }

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    // ============ Merkle Root Management ============

    /**
     * @notice Set or update the Merkle root of valid commitment hashes
     * @dev Called by owner after each batch of CD keys is generated
     * @param newRoot The new Merkle root
     */
    function setMerkleRoot(bytes32 newRoot) external onlyOwner {
        if (newRoot == bytes32(0)) revert InvalidCommitmentHash();
        bytes32 oldRoot = merkleRoot;
        merkleRoot = newRoot;
        emit MerkleRootUpdated(oldRoot, newRoot);
    }

    /**
     * @notice Verify a commitment hash is valid against the Merkle tree
     * @param cdCommitmentHash The commitment hash to verify
     * @param merkleProof The proof path
     * @return True if valid
     */
    function verifyCommitmentHash(
        bytes32 cdCommitmentHash,
        bytes32[] calldata merkleProof
    ) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(cdCommitmentHash));
        return MerkleProof.verify(merkleProof, merkleRoot, leaf);
    }

    // ============ Minting Functions ============

    /**
     * @notice Mint NFT paying with ETH
     * @param cdCommitmentHash Commitment hash from the database
     * @param merkleProof Proof that commitment hash is in the current Merkle tree
     */
    function mintWithETH(
        bytes32 cdCommitmentHash,
        bytes32[] calldata merkleProof
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < mintPriceETH) revert InsufficientPayment();
        _validateAndMint(cdCommitmentHash, merkleProof);
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
     * @notice Mint NFT paying with USDT
     * @param cdCommitmentHash Commitment hash from the database
     * @param merkleProof Proof that commitment hash is in the current Merkle tree
     */
    function mintWithUSDT(
        bytes32 cdCommitmentHash,
        bytes32[] calldata merkleProof
    ) external whenNotPaused nonReentrant {
        _validateAndMint(cdCommitmentHash, merkleProof);
        USDT.safeTransferFrom(msg.sender, address(this), mintPriceUSD);
        uint256 tokenId = _mintNFT(msg.sender, cdCommitmentHash);

        emit NFTMinted(tokenId, msg.sender, address(USDT), cdCommitmentHash);
    }

    /**
     * @notice Mint NFT paying with USDC
     * @param cdCommitmentHash Commitment hash from the database
     * @param merkleProof Proof that commitment hash is in the current Merkle tree
     */
    function mintWithUSDC(
        bytes32 cdCommitmentHash,
        bytes32[] calldata merkleProof
    ) external whenNotPaused nonReentrant {
        _validateAndMint(cdCommitmentHash, merkleProof);
        USDC.safeTransferFrom(msg.sender, address(this), mintPriceUSD);
        uint256 tokenId = _mintNFT(msg.sender, cdCommitmentHash);

        emit NFTMinted(tokenId, msg.sender, address(USDC), cdCommitmentHash);
    }

    /**
     * @dev Validates commitment hash and marks it as used
     */
    function _validateAndMint(
        bytes32 cdCommitmentHash,
        bytes32[] calldata merkleProof
    ) private {
        if (nextTokenId > maxSupply) revert MaxSupplyReached();
        if (merkleRoot == bytes32(0)) revert MerkleRootNotSet();
        if (cdCommitmentHash == bytes32(0)) revert InvalidCommitmentHash();
        if (usedCommitmentHashes[cdCommitmentHash])
            revert CommitmentHashAlreadyUsed();
        if (!verifyCommitmentHash(cdCommitmentHash, merkleProof))
            revert InvalidCommitmentHash();

        // Mark as used to prevent replay
        usedCommitmentHashes[cdCommitmentHash] = true;
    }

    function _mintNFT(
        address to,
        bytes32 cdCommitmentHash
    ) private returns (uint256) {
        uint256 tokenId = nextTokenId++;
        commitmentHash[tokenId] = cdCommitmentHash;
        _safeMint(to, tokenId);
        return tokenId;
    }

    // ============ CD-Key Claim ============

    function claimCdKey(
        uint256 tokenId,
        bytes32 cdKeyHash,
        bytes calldata ownerEncryptedKey
    ) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (isClaimed[tokenId]) revert AlreadyClaimed();
        if (commitmentHash[tokenId] != cdKeyHash)
            revert InvalidCommitmentHash();

        encryptedCdKey[tokenId] = ownerEncryptedKey;
        isClaimed[tokenId] = true;
        claimTimestamp[tokenId] = block.timestamp;

        emit CdKeyClaimed(tokenId, msg.sender, cdKeyHash);
    }

    function getEncryptedCDKey(
        uint256 tokenId
    ) external view returns (bytes memory) {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (!isClaimed[tokenId]) revert NotClaimed();
        return encryptedCdKey[tokenId];
    }

    function getCommitmentHash(
        uint256 tokenId
    ) external view returns (bytes32) {
        return commitmentHash[tokenId];
    }

    function isClaimedToken(uint256 tokenId) external view returns (bool) {
        return isClaimed[tokenId];
    }

    function getClaimTimestamp(
        uint256 tokenId
    ) external view returns (uint256) {
        return claimTimestamp[tokenId];
    }

    // ============ Burn ============

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

    function setRoyaltyInfo(
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        require(feeNumerator <= 1000, "Royalty too high (max 10%)");
        _setDefaultRoyalty(receiver, feeNumerator);
        emit RoyaltyUpdated(receiver, feeNumerator);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ============ Admin ============

    function setMintPrices(
        uint256 ethPrice,
        uint256 usdPrice
    ) external onlyOwner {
        mintPriceETH = uint128(ethPrice);
        mintPriceUSD = uint128(usdPrice);
        emit MintPriceUpdated(ethPrice, usdPrice);
    }

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

    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(
            newMaxSupply >= nextTokenId - 1,
            "Cannot set below current supply"
        );
        uint256 oldSupply = maxSupply;
        maxSupply = uint64(newMaxSupply);
        emit MaxSupplyUpdated(oldSupply, newMaxSupply);
    }

    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1 - _burnedCount;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawETH() external onlyOwner nonReentrant {
        (bool success, ) = payable(owner()).call{value: address(this).balance}(
            ""
        );
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

    function emergencyWithdrawToken(
        address token
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        IERC20 t = IERC20(token);
        t.safeTransfer(owner(), t.balanceOf(address(this)));
    }

    receive() external payable {}
}
