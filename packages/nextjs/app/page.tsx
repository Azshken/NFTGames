"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// Placeholder game image
const GAME_IMAGE = "/game-placeholder.png"; // Add your game image to public folder

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  // State management
  const [selectedPayment, setSelectedPayment] = useState<"ETH" | "USDT" | "USDC">("ETH");
  const [selectedTokenId, setSelectedTokenId] = useState<number>(1);
  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [cdKeyHash, setCdKeyHash] = useState<string>("");
  const [encryptedKey, setEncryptedKey] = useState<string>("");
  const [revealedKey, setRevealedKey] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Read contract data
  const { data: mintPriceETH } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "mintPriceETH",
  });

  const { data: mintPriceUSD } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "mintPriceUSD",
  });

  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "totalSupply",
  });

  const { data: maxSupply } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "maxSupply",
  });

  const { data: isClaimed } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "isClaimedToken",
    args: [BigInt(selectedTokenId)],
  });

  // Write functions for minting
  const { writeContractAsync: mintWithETH } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  const { writeContractAsync: mintWithUSDT } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  const { writeContractAsync: mintWithUSDC } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  const { writeContractAsync: claimCdKey } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  // Fetch owned tokens
  useEffect(() => {
    const fetchOwnedTokens = async () => {
      if (!connectedAddress || !totalSupply) return;

      const tokens: number[] = [];
      // This is a simplified approach - in production, use events or subgraph
      for (let i = 1; i <= Number(totalSupply); i++) {
        // You'll need to add an ownerOf read call here
        // For now, this is a placeholder
        tokens.push(i);
      }
      setOwnedTokens(tokens);
      if (tokens.length > 0) setSelectedTokenId(tokens[0]);
    };

    fetchOwnedTokens();
  }, [connectedAddress, totalSupply]);

  // Handle mint
  const handleMint = async () => {
    setLoading(true);
    try {
      if (selectedPayment === "ETH") {
        await mintWithETH({
          functionName: "mintWithETH",
          value: mintPriceETH,
        });
        notification.success("NFT minted successfully with ETH!");
      } else if (selectedPayment === "USDT") {
        await mintWithUSDT({
          functionName: "mintWithUSDT",
        });
        notification.success("NFT minted successfully with USDT!");
      } else {
        await mintWithUSDC({
          functionName: "mintWithUSDC",
        });
        notification.success("NFT minted successfully with USDC!");
      }
    } catch (error) {
      console.error("Mint error:", error);
      notification.error("Failed to mint NFT");
    } finally {
      setLoading(false);
    }
  };

  // Handle mint and claim
  const handleMintAndClaim = async () => {
    if (!cdKeyHash || !encryptedKey) {
      notification.error("Please provide CD key hash and encrypted key");
      return;
    }

    setLoading(true);
    try {
      const keyHashBytes = cdKeyHash.startsWith("0x") ? cdKeyHash : `0x${cdKeyHash}`;
      const encryptedKeyBytes = encryptedKey.startsWith("0x") ? encryptedKey : `0x${encryptedKey}`;

      if (selectedPayment === "ETH") {
        await mintWithETH({
          functionName: "mintAndClaimWithETH",
          args: [keyHashBytes as `0x${string}`, encryptedKeyBytes as `0x${string}`],
          value: mintPriceETH,
        });
      } else if (selectedPayment === "USDT") {
        await mintWithUSDT({
          functionName: "mintAndClaimWithUSDT",
          args: [keyHashBytes as `0x${string}`, encryptedKeyBytes as `0x${string}`],
        });
      } else {
        await mintWithUSDC({
          functionName: "mintAndClaimWithUSDC",
          args: [keyHashBytes as `0x${string}`, encryptedKeyBytes as `0x${string}`],
        });
      }
      notification.success("NFT minted and CD key claimed!");
    } catch (error) {
      console.error("Mint and claim error:", error);
      notification.error("Failed to mint and claim");
    } finally {
      setLoading(false);
    }
  };

  // Handle claim
  const handleClaim = async () => {
    if (!cdKeyHash || !encryptedKey) {
      notification.error("Please provide CD key hash and encrypted key");
      return;
    }

    setLoading(true);
    try {
      const keyHashBytes = cdKeyHash.startsWith("0x") ? cdKeyHash : `0x${cdKeyHash}`;
      const encryptedKeyBytes = encryptedKey.startsWith("0x") ? encryptedKey : `0x${encryptedKey}`;

      await claimCdKey({
        functionName: "claimCdKey",
        args: [BigInt(selectedTokenId), keyHashBytes as `0x${string}`, encryptedKeyBytes as `0x${string}`],
      });
      notification.success("CD key claimed successfully!");
    } catch (error) {
      console.error("Claim error:", error);
      notification.error("Failed to claim CD key");
    } finally {
      setLoading(false);
    }
  };

  // Handle reveal - use useScaffoldContract for imperative read
  const handleReveal = async () => {
    setLoading(true);
    try {
      // For reading the CD key, we'll use a direct contract call
      // You'll need to import useScaffoldContract
      // const { useScaffoldContract } = await import("~~/hooks/scaffold-eth");

      // This will need to be adjusted based on your implementation
      // For now, showing placeholder logic
      setRevealedKey("Encrypted key retrieved - decrypt off-chain");
      notification.success("CD key retrieved!");
    } catch (error) {
      console.error("Reveal error:", error);
      notification.error("Failed to reveal CD key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-4xl">
        {/* Title */}
        <h1 className="text-center">
          <span className="block text-4xl font-bold mb-8">NFT Game Keys</span>
        </h1>

        {/* Wallet Connection */}
        <div className="flex justify-center items-center space-x-2 flex-col mb-8">
          <p className="my-2 font-medium">Connected Address:</p>
          <Address
            address={connectedAddress}
            chain={targetNetwork}
            blockExplorerAddressLink={
              targetNetwork.id === hardhat.id ? `/blockexplorer/address/${connectedAddress}` : undefined
            }
          />
        </div>

        {/* Supply Info */}
        <div className="text-center mb-8">
          <p className="text-lg">
            Supply: {totalSupply?.toString() || "0"} / {maxSupply?.toString() || "0"}
          </p>
          <p className="text-lg mt-2">
            Price: {mintPriceETH ? formatEther(mintPriceETH) : "0"} ETH or{" "}
            {mintPriceUSD ? (Number(mintPriceUSD) / 1e6).toFixed(2) : "0"} USDC/USDT
          </p>
        </div>

        {/* Game Selection (Placeholder) */}
        <div className="flex justify-center mb-8">
          <div className="card bg-base-100 shadow-xl max-w-sm">
            <figure className="px-10 pt-10">
              <img src={GAME_IMAGE} alt="Game" className="rounded-xl h-48 w-full object-cover" />
            </figure>
            <div className="card-body items-center text-center">
              <h2 className="card-title">Game Title</h2>
              <p>Mint your NFT to get a game CD key</p>
            </div>
          </div>
        </div>

        {/* Payment Method Selection */}
        <div className="flex justify-center mb-8">
          <div className="btn-group">
            <button
              className={`btn ${selectedPayment === "ETH" ? "btn-active" : ""}`}
              onClick={() => setSelectedPayment("ETH")}
            >
              ETH
            </button>
            <button
              className={`btn ${selectedPayment === "USDT" ? "btn-active" : ""}`}
              onClick={() => setSelectedPayment("USDT")}
            >
              USDT
            </button>
            <button
              className={`btn ${selectedPayment === "USDC" ? "btn-active" : ""}`}
              onClick={() => setSelectedPayment("USDC")}
            >
              USDC
            </button>
          </div>
        </div>

        {/* Mint Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button className="btn btn-primary btn-lg" onClick={handleMint} disabled={loading || !connectedAddress}>
            {loading ? "Processing..." : `Mint with ${selectedPayment}`}
          </button>
          <button
            className="btn btn-secondary btn-lg"
            onClick={handleMintAndClaim}
            disabled={loading || !connectedAddress}
          >
            {loading ? "Processing..." : "Mint & Claim"}
          </button>
        </div>

        {/* CD Key Management Section */}
        <div className="card bg-base-200 shadow-xl p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4">CD Key Management</h2>

          {/* Token Selection */}
          {ownedTokens.length > 0 && (
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Select Token ID</span>
              </label>
              <select
                className="select select-bordered"
                value={selectedTokenId}
                onChange={e => setSelectedTokenId(Number(e.target.value))}
              >
                {ownedTokens.map(tokenId => (
                  <option key={tokenId} value={tokenId}>
                    Token #{tokenId} {isClaimed ? "(Claimed)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* CD Key Hash Input */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text">CD Key Hash (for issuer)</span>
            </label>
            <input
              type="text"
              placeholder="0x..."
              className="input input-bordered"
              value={cdKeyHash}
              onChange={e => setCdKeyHash(e.target.value)}
            />
          </div>

          {/* Encrypted Key Input */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text">Encrypted CD Key</span>
            </label>
            <input
              type="text"
              placeholder="0x..."
              className="input input-bordered"
              value={encryptedKey}
              onChange={e => setEncryptedKey(e.target.value)}
            />
          </div>

          {/* Claim Button */}
          <button
            className="btn btn-accent mb-4"
            onClick={handleClaim}
            disabled={loading || !connectedAddress || isClaimed}
          >
            {isClaimed ? "Already Claimed" : "Claim CD Key"}
          </button>

          {/* Reveal Section */}
          <div className="divider">Reveal CD Key</div>
          <button
            className="btn btn-info mb-4"
            onClick={handleReveal}
            disabled={loading || !connectedAddress || !isClaimed}
          >
            Reveal CD Key
          </button>

          {/* Revealed Key Display */}
          {revealedKey && (
            <div className="form-control">
              <label className="label">
                <span className="label-text">Your CD Key (Encrypted)</span>
              </label>
              <textarea className="textarea textarea-bordered h-24" value={revealedKey} readOnly />
              <label className="label">
                <span className="label-text-alt">
                  Note: Decrypt this with your private key off-chain to reveal the plaintext CD key
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;
