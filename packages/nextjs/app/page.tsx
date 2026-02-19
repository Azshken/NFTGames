// packages/nextjs/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { decodeEventLog, formatEther, parseAbiItem } from "viem";
import { hardhat } from "viem/chains";
import { useAccount, usePublicClient } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

// packages/nextjs/app/page.tsx

const GAME_IMAGE =
  "https://purple-historical-sawfish-33.mypinata.cloud/ipfs/bafybeiaiedjkix3n3qx6il3lwj2ye7y5fkbaytu7m4q6yxlde5uqrsgztm";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient();

  const [selectedPayment, setSelectedPayment] = useState<"ETH" | "USDT" | "USDC">("ETH");
  const [selectedTokenId, setSelectedTokenId] = useState<number>(0);
  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [revealedKey, setRevealedKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [mintingStep, setMintingStep] = useState<string>("");

  // ============ Contract Reads ============

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

  const { data: isClaimed, refetch: refetchIsClaimed } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "isClaimedToken",
    args: [BigInt(selectedTokenId || 0)],
    query: {
      enabled: selectedTokenId > 0,
    },
  });

  const { data: deployedContractData } = useDeployedContractInfo({ contractName: "SoulboundNFT" });
  const contractAddress = deployedContractData?.address;

  // Reset stale state when wallet changes
  useEffect(() => {
    setOwnedTokens([]);
    setSelectedTokenId(0);
    setRevealedKey("");
  }, [connectedAddress]);

  // ============ Contract Writes ============

  const { writeContractAsync: writeContract } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  // ============ Fetch Owned Tokens ============

  useEffect(() => {
    const fetchOwnedTokens = async () => {
      if (!connectedAddress || !publicClient || !totalSupply || !contractAddress) return;

      try {
        const logs = await publicClient.getLogs({
          address: contractAddress, // ← was process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
          fromBlock: 0n,
          toBlock: "latest",
        });

        const tokens: number[] = [];

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
  }, [connectedAddress, totalSupply, publicClient, contractAddress]);

  // ============ Mint ============

  const handleMint = async () => {
    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }

    setLoading(true);
    setMintingStep("Getting commitment hash from database...");

    try {
      // Step 1: Get commitment hash
      const commitmentRes = await fetch("/api/mint/get-commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedAddress }),
      });

      const commitmentData = await commitmentRes.json();

      if (!commitmentData.success) {
        throw new Error(commitmentData.error || "Failed to get commitment hash");
      }

      // Format commitment hash as bytes32
      const commitmentHashBytes32 = (
        commitmentData.commitmentHash.startsWith("0x")
          ? commitmentData.commitmentHash
          : `0x${commitmentData.commitmentHash}`
      ) as `0x${string}`;

      setMintingStep(`Minting NFT with ${selectedPayment}...`);

      // Step 2: Mint on-chain with commitment hash + proof
      let txHash;

      if (selectedPayment === "ETH") {
        txHash = await writeContract({
          functionName: "mintWithETH",
          args: [commitmentHashBytes32],
          value: mintPriceETH,
        });
      } else if (selectedPayment === "USDT") {
        txHash = await writeContract({
          functionName: "mintWithUSDT",
          args: [commitmentHashBytes32],
        });
      } else {
        txHash = await writeContract({
          functionName: "mintWithUSDC",
          args: [commitmentHashBytes32],
        });
      }

      setMintingStep("Waiting for transaction confirmation...");

      const receipt = await publicClient?.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (!receipt) throw new Error("Transaction receipt not found");

      // Step 3: Extract tokenId from Transfer event
      let tokenId: bigint | undefined;

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)")],
            data: log.data,
            topics: log.topics,
          });

          if (decoded.args.from === "0x0000000000000000000000000000000000000000") {
            tokenId = decoded.args.tokenId;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!tokenId) throw new Error("Could not extract token ID from transaction");

      setMintingStep("Linking token to database...");

      // Step 4: Link token ID to CD key in database
      await fetch("/api/mint/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: commitmentData.cdkeyId,
          tokenId: tokenId.toString(),
          walletAddress: connectedAddress,
        }),
      });

      setSelectedTokenId(Number(tokenId));
      setOwnedTokens(prev => [...prev, Number(tokenId)]);

      notification.success(`NFT minted! Token #${tokenId} — now claim your CD key.`);
      setMintingStep("");
    } catch (error: any) {
      console.error("Mint error:", error);
      notification.error(`Failed to mint: ${error.message}`);
      setMintingStep("");
    } finally {
      setLoading(false);
    }
  };

  // ============ Claim CD Key ============

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
    setMintingStep("Requesting encryption public key from MetaMask...");

    try {
      // Step 1: Get user's MetaMask encryption public key
      const userPublicKey = await (window as any).ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [connectedAddress],
      });

      setMintingStep("Retrieving and encrypting CD key...");

      // Step 2: Backend decrypts with server key, re-encrypts with user's MetaMask key
      const redeemRes = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: selectedTokenId,
          userAddress: connectedAddress,
          userPublicKey,
        }),
      });

      const redeemData = await redeemRes.json();

      if (!redeemData.success) {
        throw new Error(redeemData.error || "Failed to retrieve CD key");
      }

      setMintingStep("Claiming CD key on blockchain...");

      // Step 3: Format commitment hash as bytes32 for contract
      const commitmentHashBytes32 = (
        redeemData.commitmentHash.startsWith("0x") ? redeemData.commitmentHash : `0x${redeemData.commitmentHash}`
      ) as `0x${string}`;

      // Step 4: Format encrypted CD key as bytes for contract
      const encryptedKeyBytes = (
        redeemData.encryptedCDKey.startsWith("0x") ? redeemData.encryptedCDKey : `0x${redeemData.encryptedCDKey}`
      ) as `0x${string}`;

      // Step 5: Submit to contract — makes NFT soulbound
      const txHash = await writeContract({
        functionName: "claimCdKey",
        args: [BigInt(selectedTokenId), commitmentHashBytes32, encryptedKeyBytes],
      });

      setMintingStep("Confirming redemption...");

      await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      // Step 6: Confirm in database — deletes server-side encrypted key
      await fetch("/api/redeem/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: redeemData.cdkeyId,
          userAddress: connectedAddress,
          txHash,
        }),
      });

      await refetchIsClaimed();

      notification.success("CD key claimed! NFT is now soulbound. Click 'Reveal CD Key' to decrypt.");
      setMintingStep("");
    } catch (error: any) {
      console.error("Claim error:", error);
      notification.error(`Failed to claim: ${error.message}`);
      setMintingStep("");
    } finally {
      setLoading(false);
    }
  };

  // ============ Reveal CD Key ============

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
      // Step 1: Read encrypted bytes from contract
      // account must be passed so msg.sender is set correctly in the view call
      const encryptedBytes = (await publicClient?.readContract({
        address: contractAddress as `0x${string}`,
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
        account: connectedAddress,
      })) as `0x${string}` | undefined;

      if (!encryptedBytes) throw new Error("No encrypted CD key found on-chain");

      setMintingStep("Decrypting with your MetaMask private key...");

      // Step 2: Decrypt with MetaMask
      const decrypted = await (window as any).ethereum.request({
        method: "eth_decrypt",
        params: [encryptedBytes, connectedAddress],
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

  // ============ Render ============

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

        {/* Game Card */}
        <div className="flex justify-center mb-8">
          <div className="card bg-base-100 shadow-xl max-w-sm">
            <figure className="px-10 pt-10">
              <Image
                src={GAME_IMAGE}
                alt="Fallout"
                width={400}
                height={192}
                className="rounded-xl h-48 w-full object-cover"
                unoptimized
              />
            </figure>
            <div className="card-body items-center text-center">
              <h2 className="card-title">Fallout</h2>
              <p className="text-sm text-base-content/70">Post-Apocalyptic RPG</p>
              <p className="text-sm">Mint your NFT to receive a unique game CD key</p>
            </div>
          </div>
        </div>

        {/* Payment Selection */}
        <div className="flex justify-center mb-8">
          <div className="join">
            {(["ETH", "USDT", "USDC"] as const).map(method => (
              <button
                key={method}
                className={`btn join-item ${selectedPayment === method ? "btn-active btn-primary" : ""}`}
                onClick={() => setSelectedPayment(method)}
                disabled={loading}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        {/* Mint Button */}
        <div className="flex justify-center mb-8">
          <button
            className="btn btn-primary btn-lg w-full max-w-md"
            onClick={handleMint}
            disabled={loading || !connectedAddress}
          >
            {loading && mintingStep ? mintingStep : `Mint NFT with ${selectedPayment}`}
          </button>
        </div>

        {/* CD Key Management */}
        {ownedTokens.length > 0 && (
          <div className="card bg-base-200 shadow-xl p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Your NFTs & CD Keys</h2>

            {/* Token Selector */}
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Select Your Token</span>
              </label>
              <select
                className="select select-bordered"
                value={selectedTokenId}
                onChange={e => {
                  setSelectedTokenId(Number(e.target.value));
                  setRevealedKey("");
                }}
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
                    {isClaimed ? "✅ CD Key Claimed — NFT is Soulbound" : "⏳ CD Key Not Claimed Yet"}
                  </span>
                </label>
              )}
            </div>

            {/* Claim Button */}
            {selectedTokenId > 0 && !isClaimed && (
              <button
                className="btn btn-accent w-full mb-4"
                onClick={handleClaimCDKey}
                disabled={loading || !connectedAddress}
              >
                {loading ? mintingStep || "Processing..." : "🔐 Claim CD Key (Makes NFT Soulbound)"}
              </button>
            )}

            {/* Reveal Section */}
            {selectedTokenId > 0 && isClaimed && (
              <>
                <div className="divider">Your CD Key</div>
                <button
                  className="btn btn-info w-full mb-4"
                  onClick={handleRevealCDKey}
                  disabled={loading || !connectedAddress}
                >
                  {loading ? mintingStep || "Processing..." : "🔑 Reveal CD Key"}
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
                <div className="flex justify-end mt-2">
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      navigator.clipboard.writeText(revealedKey);
                      notification.success("Copied to clipboard!");
                    }}
                  >
                    📋 Copy Key
                  </button>
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
        <div className="alert alert-info shadow-lg mb-8">
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
            />
          </svg>
          <div>
            <h3 className="font-bold">How it works:</h3>
            <ol className="text-xs list-decimal list-inside space-y-1 mt-1">
              <li>Claim your CD key — encrypted with your MetaMask key and stored on-chain</li>
              <li>Your NFT becomes permanently soulbound (non-transferable)</li>
              <li>Reveal your CD key anytime by decrypting with MetaMask</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
