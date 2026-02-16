"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { decodeEventLog, formatEther, parseAbiItem } from "viem";
import { hardhat } from "viem/chains";
import { useAccount, usePublicClient } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";
import Image from "next/image";

// Placeholder game image
const GAME_IMAGE =
  "https://purple-historical-sawfish-33.mypinata.cloud/ipfs/bafybeiaiedjkix3n3qx6il3lwj2ye7y5fkbaytu7m4q6yxlde5uqrsgztm";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient();

  // State management
  const [selectedPayment, setSelectedPayment] = useState<"ETH" | "USDT" | "USDC">("ETH");
  const [selectedTokenId, setSelectedTokenId] = useState<number>(0);
  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [revealedKey, setRevealedKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [mintingStep, setMintingStep] = useState<string>("");

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
    args: [BigInt(selectedTokenId || 0)], // Always provide args
    query: {
      enabled: selectedTokenId > 0, // Only execute when we have a valid token
    },
  });

  // Write functions
  const { writeContractAsync: writeContract } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  // Fetch owned tokens on load
  useEffect(() => {
    const fetchOwnedTokens = async () => {
      if (!connectedAddress || !publicClient || !totalSupply) return;

      try {
        const tokens: number[] = [];

        // Get Transfer events to find user's tokens
        const logs = await publicClient.getLogs({
          address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Filter for transfers to the user
        for (const log of logs) {
          if (log.args?.to?.toLowerCase() === connectedAddress.toLowerCase()) {
            const tokenId = log.args?.tokenId;
            if (tokenId !== undefined) {
              tokens.push(Number(tokenId));
            }
          }
        }

        setOwnedTokens(tokens);
        if (tokens.length > 0) setSelectedTokenId(tokens[0]);
      } catch (error) {
        console.error("Error fetching owned tokens:", error);
      }
    };

    fetchOwnedTokens();
  }, [connectedAddress, totalSupply, publicClient]);

  // Handle mint (without immediate claim)
  const handleMint = async () => {
    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }

    setLoading(true);
    setMintingStep("Getting commitment hash from database...");

    try {
      // Step 1: Get commitment hash from backend
      const commitmentRes = await fetch("/api/mint/get-commitment", {
        method: "POST",
      });

      const commitmentData = await commitmentRes.json();

      if (!commitmentData.success) {
        throw new Error(commitmentData.error || "Failed to get commitment hash");
      }

      // setCdkeyId(commitmentData.cdkeyId);
      setMintingStep(`Minting NFT with ${selectedPayment}...`);

      // Step 2: Mint NFT with commitment hash
      let txHash;
      // const commitmentHashBytes = commitmentData.commitmentHash.startsWith("0x")
      //   ? commitmentData.commitmentHash
      //   : `0x${commitmentData.commitmentHash}`;

      if (selectedPayment === "ETH") {
        txHash = await writeContract({
          functionName: "mintWithETH",
          // args: [commitmentHashBytes as `0x${string}`],
          value: mintPriceETH,
        });
      } else if (selectedPayment === "USDT") {
        txHash = await writeContract({
          functionName: "mintWithUSDT",
          // args: [commitmentHashBytes],
        });
      } else {
        txHash = await writeContract({
          functionName: "mintWithUSDC",
          // args: [commitmentHashBytes],
        });
      }

      setMintingStep("Waiting for transaction confirmation...");

      // Step 3: Wait for transaction and get token ID
      const receipt = await publicClient?.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (!receipt) {
        throw new Error("Transaction receipt not found");
      }

      // Parse Transfer event to get tokenId
      let tokenId: bigint | undefined;

      for (const log of receipt.logs) {
        try {
          // Try to decode as Transfer event
          const decoded = decodeEventLog({
            abi: [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)")],
            data: log.data,
            topics: log.topics,
          });

          // If from is zero address, it's a mint
          if (decoded.args.from === "0x0000000000000000000000000000000000000000") {
            tokenId = decoded.args.tokenId;
            break;
          }
        } catch {
          // Not a Transfer event, skip
          continue;
        }
      }

      if (!tokenId) {
        throw new Error("Could not extract token ID from transaction");
      }

      setMintingStep("Linking token to database...");

      // Step 4: Link token ID in database
      await fetch("/api/mint/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: commitmentData.cdkeyId,
          tokenId: tokenId.toString(),
        }),
      });

      setSelectedTokenId(Number(tokenId));
      setOwnedTokens(prev => [...prev, Number(tokenId)]);

      notification.success(`NFT minted successfully! Token ID: ${tokenId}`);
      setMintingStep("");
    } catch (error: any) {
      console.error("Mint error:", error);
      notification.error(`Failed to mint: ${error.message}`);
      setMintingStep("");
    } finally {
      setLoading(false);
    }
  };

  // Handle claim CD key
  const handleClaimCDKey = async () => {
    if (!connectedAddress || !selectedTokenId) {
      notification.error("Please select a token");
      return;
    }

    if (isClaimed) {
      notification.error("This token's CD key has already been claimed");
      return;
    }

    setLoading(true);
    setMintingStep("Requesting encryption public key...");

    try {
      // Step 1: Get user's public key from MetaMask
      const publicKey = await (window as any).ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [connectedAddress],
      });

      setMintingStep("Retrieving CD key from database...");

      // Step 2: Get encrypted CD key from backend
      const redeemRes = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: selectedTokenId,
          userAddress: connectedAddress,
          userPublicKey: publicKey,
        }),
      });

      const redeemData = await redeemRes.json();

      if (!redeemData.success) {
        throw new Error(redeemData.error || "Failed to retrieve CD key");
      }

      setMintingStep("Claiming CD key on blockchain...");

      // Step 3: Submit to smart contract
      const commitmentHashBytes = redeemData.commitmentHash.startsWith("0x")
        ? redeemData.commitmentHash
        : `0x${redeemData.commitmentHash}`;

      const encryptedKeyBytes = redeemData.encryptedCDKey.startsWith("0x")
        ? redeemData.encryptedCDKey
        : `0x${redeemData.encryptedCDKey}`;

      const txHash = await writeContract({
        functionName: "claimCdKey",
        args: [BigInt(selectedTokenId), commitmentHashBytes as `0x${string}`, encryptedKeyBytes as `0x${string}`],
      });
      setMintingStep("Confirming redemption...");

      await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      // Step 4: Confirm in database (cleanup)
      await fetch("/api/redeem/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: redeemData.cdkeyId,
          userAddress: connectedAddress,
          txHash,
        }),
      });

      notification.success("CD key claimed successfully! Click 'Reveal CD Key' to decrypt it.");
      setMintingStep("");
    } catch (error: any) {
      console.error("Claim error:", error);
      notification.error(`Failed to claim: ${error.message}`);
      setMintingStep("");
    } finally {
      setLoading(false);
    }
  };

  // Handle reveal CD key
  const handleRevealCDKey = async () => {
    if (!connectedAddress || !selectedTokenId) {
      notification.error("Please select a token");
      return;
    }

    if (!isClaimed) {
      notification.error("This token's CD key hasn't been claimed yet");
      return;
    }

    setLoading(true);
    setMintingStep("Retrieving encrypted CD key from blockchain...");

    try {
      // Step 1: Read encrypted CD key from contract
      const encryptedKeyFromContract = await publicClient?.readContract({
        address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
        abi: [
          {
            inputs: [{ name: "tokenId", type: "uint256" }],
            name: "getEncryptedCDKey",
            outputs: [{ name: "", type: "bytes" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        functionName: "getEncryptedCDKey",
        args: [BigInt(selectedTokenId)],
      });

      if (!encryptedKeyFromContract) {
        throw new Error("No encrypted CD key found");
      }

      setMintingStep("Decrypting with your private key...");

      // Step 2: Decrypt with MetaMask
      const encryptedHex = encryptedKeyFromContract.toString().replace("0x", "");

      const decrypted = await (window as any).ethereum.request({
        method: "eth_decrypt",
        params: [encryptedHex, connectedAddress],
      });

      setRevealedKey(decrypted);
      notification.success("CD key revealed successfully!");
      setMintingStep("");
    } catch (error: any) {
      console.error("Reveal error:", error);
      notification.error(`Failed to reveal: ${error.message}`);
      setMintingStep("");
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

        {/* Game Selection */}
        <div className="flex justify-center mb-8">
          <div className="card bg-base-100 shadow-xl max-w-sm">
            <figure className="px-10 pt-10">
              <image 
                src={GAME_IMAGE}
                alt="Game" width={400}
                height={192}
                className="rounded-xl h-48 w-full object-cover" 
                unoptimized
              />
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
              disabled={loading}
            >
              ETH
            </button>
            <button
              className={`btn ${selectedPayment === "USDT" ? "btn-active" : ""}`}
              onClick={() => setSelectedPayment("USDT")}
              disabled={loading}
            >
              USDT
            </button>
            <button
              className={`btn ${selectedPayment === "USDC" ? "btn-active" : ""}`}
              onClick={() => setSelectedPayment("USDC")}
              disabled={loading}
            >
              USDC
            </button>
          </div>
        </div>

        {/* Mint Button */}
        <div className="flex justify-center mb-8">
          <button
            className="btn btn-primary btn-lg w-full max-w-md"
            onClick={handleMint}
            disabled={loading || !connectedAddress}
          >
            {loading ? mintingStep || "Processing..." : `Mint NFT with ${selectedPayment}`}
          </button>
        </div>

        {/* CD Key Management Section */}
        {ownedTokens.length > 0 && (
          <div className="card bg-base-200 shadow-xl p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Your NFTs & CD Keys</h2>

            {/* Token Selection */}
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Select Your Token</span>
              </label>
              <select
                className="select select-bordered"
                value={selectedTokenId}
                onChange={e => setSelectedTokenId(Number(e.target.value))}
                disabled={loading}
              >
                {ownedTokens.map(tokenId => (
                  <option key={tokenId} value={tokenId}>
                    Token #{tokenId}
                  </option>
                ))}
              </select>
              {selectedTokenId > 0 && (
                <label className="label">
                  <span className="label-text-alt">
                    Status: {isClaimed ? "✅ CD Key Claimed" : "⏳ Not Claimed Yet"}
                  </span>
                </label>
              )}
            </div>

            {/* Claim Button */}
            {selectedTokenId > 0 && !isClaimed && (
              <button
                className="btn btn-accent mb-4"
                onClick={handleClaimCDKey}
                disabled={loading || !connectedAddress}
              >
                {loading ? mintingStep || "Processing..." : "Claim CD Key"}
              </button>
            )}

            {/* Reveal Section */}
            {selectedTokenId > 0 && isClaimed && (
              <>
                <div className="divider">Reveal Your CD Key</div>
                <button
                  className="btn btn-info mb-4"
                  onClick={handleRevealCDKey}
                  disabled={loading || !connectedAddress}
                >
                  {loading ? mintingStep || "Processing..." : "Reveal CD Key"}
                </button>
              </>
            )}

            {/* Revealed Key Display */}
            {revealedKey && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-bold">🎮 Your Game CD Key:</span>
                </label>
                <div className="mockup-code">
                  <pre className="text-success">
                    <code>{revealedKey}</code>
                  </pre>
                </div>
                <label className="label">
                  <span className="label-text-alt text-warning">
                    ⚠️ This key is unique and can only be used once. Keep it safe!
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="alert alert-info shadow-lg">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              className="stroke-current flex-shrink-0 w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <div>
              <h3 className="font-bold">How it works:</h3>
              <div className="text-xs">
                <p>1. Mint your NFT (commitment hash is stored on-chain)</p>
                <p>2. Claim your CD key (encrypted with your public key & stored on-chain)</p>
                <p>3. Reveal the CD key (decrypt with your MetaMask)</p>
                <p>4. Your NFT becomes soulbound (non-transferable) after claiming</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
