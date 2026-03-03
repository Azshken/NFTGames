// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { decodeEventLog, formatEther, parseAbi, parseAbiItem } from "viem";
import { hardhat } from "viem/chains";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const GAME_IMAGE =
  "https://purple-historical-sawfish-33.mypinata.cloud/ipfs/bafybeiaiedjkix3n3qx6il3lwj2ye7y5fkbaytu7m4q6yxlde5uqrsgztm";

// MasterKeyVault ABI — only what the frontend needs
const VAULT_ABI = parseAbi([
  "function isRefundable(address soulKeyContract, uint256 tokenId) view returns (bool)",
  "function paymentRecords(address soulKeyContract, uint256 tokenId) view returns (address paymentToken, uint48 paidAt, uint8 status, uint256 amount, address payer)",
  "function processRefund(address soulKeyContract, uint256 tokenId, string calldata reason) nonpayable",
  "event RefundIssued(address indexed soulKeyContract, uint256 indexed tokenId, address indexed recipient, address paymentToken, uint256 refundedAmount, uint256 feeRetained, string reason)",
  "function refundFeeBps() view returns (uint256)",
]);

const REFUND_WINDOW_SECS = 14 * 24 * 60 * 60; // 14 days in seconds

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
  const [refundReason, setRefundReason] = useState<string>("");
  const [showRefundInput, setShowRefundInput] = useState(false);
  const [isRefundable, setIsRefundable] = useState(false);
  const [refundWindowExpiry, setRefundWindowExpiry] = useState<Date | null>(null);

  // ============ Contract Reads (SoulKey) ============
  const { data: mintPriceETH } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "mintPriceETH",
  });
  const { data: mintPriceUSD } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "mintPriceUSD",
  });
  const { data: totalSupply } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "totalSupply",
  });
  const { data: maxSupply } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "maxSupply",
  });
  // SoulKey has getClaimTimestamp(tokenId) — isClaimed = timestamp > 0
  const { data: claimTimestamp, refetch: refetchClaimTimestamp } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "getClaimTimestamp",
    args: [BigInt(selectedTokenId || 0)],
    query: { enabled: selectedTokenId > 0 },
  });
  const isClaimed = claimTimestamp !== undefined && claimTimestamp > 0n;

  // Read vault address from SoulKey (immutable public field)
  const { data: vaultAddress } = useScaffoldReadContract({
    contractName: "SoulKey",
    functionName: "vault",
  });

  const { data: deployedContractData } = useDeployedContractInfo({ contractName: "SoulKey" });
  const contractAddress = deployedContractData?.address;

  // Raw wagmi write for vault's processRefund (vault is not a scaffold contract)
  const { writeContractAsync: writeVault } = useWriteContract();

  // ============ Contract Writes (SoulKey) ============
  const { writeContractAsync: writeContract } = useScaffoldWriteContract({
    contractName: "SoulKey",
  });

  // Reset stale state when wallet changes
  useEffect(() => {
    setOwnedTokens([]);
    setSelectedTokenId(0);
    setRevealedKey("");
  }, [connectedAddress]);

  // Reset refund UI when token changes
  useEffect(() => {
    setIsRefundable(false);
    setRefundWindowExpiry(null);
    setShowRefundInput(false);
    setRevealedKey("");
  }, [selectedTokenId]);

  // ============ Fetch Refund Status ============
  useEffect(() => {
    const fetchRefundStatus = async () => {
      if (!publicClient || !vaultAddress || !contractAddress || !selectedTokenId) return;
      try {
        const [refundable, record] = await Promise.all([
          publicClient.readContract({
            address: vaultAddress as `0x${string}`,
            abi: VAULT_ABI,
            functionName: "isRefundable",
            args: [contractAddress as `0x${string}`, BigInt(selectedTokenId)],
          }),
          publicClient.readContract({
            address: vaultAddress as `0x${string}`,
            abi: VAULT_ABI,
            functionName: "paymentRecords",
            args: [contractAddress as `0x${string}`, BigInt(selectedTokenId)],
          }),
        ]);
        setIsRefundable(refundable as boolean);
        const paidAt = (record as any)[1] as bigint;
        if (paidAt > 0n) {
          setRefundWindowExpiry(new Date(Number(paidAt + BigInt(REFUND_WINDOW_SECS)) * 1000));
        }
      } catch {
        // Token may not have a payment record yet (e.g. just minted, not yet confirmed)
      }
    };
    if (selectedTokenId > 0 && !isClaimed) fetchRefundStatus();
  }, [selectedTokenId, isClaimed, publicClient, vaultAddress, contractAddress]);

  // ============ Fetch Owned Tokens ============
  useEffect(() => {
    const fetchOwnedTokens = async () => {
      if (!connectedAddress || !publicClient || !totalSupply || !contractAddress) return;
      try {
        const logs = await publicClient.getLogs({
          address: contractAddress,
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
          fromBlock: 0n,
          toBlock: "latest",
        });
        const tokens: number[] = [];
        for (const log of logs) {
          if (log.args?.to?.toLowerCase() === connectedAddress.toLowerCase()) {
            const tokenId = log.args?.tokenId;
            if (tokenId !== undefined) tokens.push(Number(tokenId));
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
    if (!connectedAddress || !contractAddress) {
      notification.error("Please connect your wallet");
      return;
    }
    setLoading(true);
    setMintingStep("Getting commitment hash from database...");
    try {
      // Step 1: Get commitment hash for this product/contract
      const commitmentRes = await fetch("/api/mint/get-commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedAddress, contractAddress }),
      });
      const commitmentData = await commitmentRes.json();
      if (!commitmentData.success) throw new Error(commitmentData.error || "Failed to get commitment hash");

      const commitmentHashBytes32 = (
        commitmentData.commitmentHash.startsWith("0x")
          ? commitmentData.commitmentHash
          : `0x${commitmentData.commitmentHash}`
      ) as `0x${string}`;

      setMintingStep(`Minting NFT with ${selectedPayment}...`);

      // Step 2: Mint on-chain
      let txHash;
      if (selectedPayment === "ETH") {
        txHash = await writeContract({
          functionName: "mintWithETH",
          args: [commitmentHashBytes32],
          value: mintPriceETH,
        });
      } else if (selectedPayment === "USDT") {
        txHash = await writeContract({ functionName: "mintWithUSDT", args: [commitmentHashBytes32] });
      } else {
        txHash = await writeContract({ functionName: "mintWithUSDC", args: [commitmentHashBytes32] });
      }

      setMintingStep("Waiting for transaction confirmation...");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      if (!receipt) throw new Error("Transaction receipt not found");

      // Step 3: Extract tokenId from Transfer event and paymentToken from NFTMinted event
      let tokenId: bigint | undefined;
      let mintedPaymentToken = "0x0000000000000000000000000000000000000000";

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)")],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.args.from === "0x0000000000000000000000000000000000000000") {
            tokenId = decoded.args.tokenId;
          }
        } catch {
          /* not a Transfer log */
        }

        try {
          const decoded = decodeEventLog({
            abi: [
              parseAbiItem(
                "event NFTMinted(uint256 indexed tokenId, address indexed minter, address indexed paymentToken, bytes32 commitmentHash)",
              ),
            ],
            data: log.data,
            topics: log.topics,
          });
          mintedPaymentToken = decoded.args.paymentToken as string;
        } catch {
          /* not an NFTMinted log */
        }
      }

      if (!tokenId) throw new Error("Could not extract token ID from transaction");

      setMintingStep("Linking token to database...");

      // Step 4: Record mint in database — inserts into `mints` table
      const paymentAmount = selectedPayment === "ETH" ? mintPriceETH!.toString() : mintPriceUSD!.toString();
      await fetch("/api/mint/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: commitmentData.cdkeyId,
          tokenId: tokenId.toString(),
          walletAddress: connectedAddress,
          txHash,
          blockNumber: receipt.blockNumber.toString(),
          paymentToken: mintedPaymentToken,
          paymentAmount,
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
      const userPublicKey = await (window as any).ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [connectedAddress],
      });

      setMintingStep("Retrieving and encrypting CD key...");
      const redeemRes = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: selectedTokenId, userAddress: connectedAddress, userPublicKey }),
      });
      const redeemData = await redeemRes.json();
      if (!redeemData.success) throw new Error(redeemData.error || "Failed to retrieve CD key");

      setMintingStep("Claiming CD key on blockchain...");
      const commitmentHashBytes32 = (
        redeemData.commitmentHash.startsWith("0x") ? redeemData.commitmentHash : `0x${redeemData.commitmentHash}`
      ) as `0x${string}`;
      const encryptedKeyBytes = (
        redeemData.encryptedCDKey.startsWith("0x") ? redeemData.encryptedCDKey : `0x${redeemData.encryptedCDKey}`
      ) as `0x${string}`;

      const txHash = await writeContract({
        functionName: "claimCdKey",
        args: [BigInt(selectedTokenId), commitmentHashBytes32, encryptedKeyBytes],
      });

      setMintingStep("Confirming redemption...");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      if (!receipt) throw new Error("Receipt not found");

      // Step 6: Confirm in DB — records in redemptions + reserve_releases tables
      await fetch("/api/redeem/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: redeemData.cdkeyId,
          userAddress: connectedAddress,
          txHash,
          blockNumber: receipt.blockNumber.toString(),
        }),
      });

      await refetchClaimTimestamp();
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
    if (!connectedAddress || !selectedTokenId || !contractAddress) return;
    if (!isClaimed) {
      notification.error("CD key hasn't been claimed yet");
      return;
    }
    setLoading(true);
    setMintingStep("Retrieving encrypted CD key from blockchain...");
    try {
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

  // ============ Refund ============
  const handleRefund = async () => {
    if (!connectedAddress || !selectedTokenId || !contractAddress || !vaultAddress) {
      notification.error("Wallet or contract not ready");
      return;
    }
    if (!isRefundable) {
      notification.error("This token is not refundable");
      return;
    }
    setLoading(true);
    setMintingStep("Processing refund on blockchain...");
    try {
      const txHash = await writeVault({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: "processRefund",
        args: [contractAddress as `0x${string}`, BigInt(selectedTokenId), refundReason || "User requested refund"],
      });

      setMintingStep("Waiting for refund confirmation...");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      if (!receipt) throw new Error("Receipt not found");

      // Parse RefundIssued event for DB record
      let refundedAmount = "0",
        feeRetained = "0",
        paymentToken = "0x0000000000000000000000000000000000000000";
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: VAULT_ABI,
            eventName: "RefundIssued",
            data: log.data,
            topics: log.topics,
          });
          refundedAmount = (decoded.args as any).refundedAmount.toString();
          feeRetained = (decoded.args as any).feeRetained.toString();
          paymentToken = (decoded.args as any).paymentToken as string;
          break;
        } catch {
          /* not RefundIssued */
        }
      }

      // Record refund in DB — inserts into `refunds` table
      await fetch("/api/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractAddress,
          tokenId: selectedTokenId.toString(),
          refundedBy: connectedAddress,
          refundReason: refundReason || "User requested refund",
          refundTxHash: txHash,
          blockNumber: receipt.blockNumber.toString(),
          paymentToken,
          refundedAmount,
          feeRetained,
        }),
      });

      setOwnedTokens(prev => prev.filter(t => t !== selectedTokenId));
      setSelectedTokenId(ownedTokens.filter(t => t !== selectedTokenId)[0] || 0);
      notification.success("Refund processed! NFT has been burned.");
      setMintingStep("");
      setShowRefundInput(false);
    } catch (error: any) {
      console.error("Refund error:", error);
      notification.error(`Refund failed: ${error.message}`);
      setMintingStep("");
    } finally {
      setLoading(false);
    }
  };

  const refundWindowHoursLeft = refundWindowExpiry
    ? Math.max(0, Math.floor((refundWindowExpiry.getTime() - Date.now()) / 3600000))
    : null;

  // ============ Render ============
  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-4xl">
        <h1 className="text-center">
          <span className="block text-4xl font-bold mb-8">NFT Game Keys</span>
        </h1>

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

        <div className="text-center mb-8">
          <p className="text-lg">
            Supply: {totalSupply?.toString() || "0"} / {maxSupply?.toString() || "0"}
          </p>
          <p className="text-lg mt-2">
            Price: {mintPriceETH ? formatEther(mintPriceETH) : "0"} ETH or{" "}
            {mintPriceUSD ? (Number(mintPriceUSD) / 1e6).toFixed(2) : "0"} USDC/USDT
          </p>
        </div>

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

        <div className="flex justify-center mb-8">
          <button
            className="btn btn-primary btn-lg w-full max-w-md"
            onClick={handleMint}
            disabled={loading || !connectedAddress}
          >
            {loading && mintingStep ? mintingStep : `Mint NFT with ${selectedPayment}`}
          </button>
        </div>

        {ownedTokens.length > 0 && (
          <div className="card bg-base-200 shadow-xl p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Your NFTs & CD Keys</h2>

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
                  {!isClaimed && refundWindowHoursLeft !== null && (
                    <span className={`label-text-alt ${refundWindowHoursLeft < 24 ? "text-error" : "text-warning"}`}>
                      🕐 Refund window: {refundWindowHoursLeft}h left
                    </span>
                  )}
                </label>
              )}
            </div>

            {selectedTokenId > 0 && !isClaimed && (
              <button
                className="btn btn-accent w-full mb-4"
                onClick={handleClaimCDKey}
                disabled={loading || !connectedAddress}
              >
                {loading ? mintingStep || "Processing..." : "🔐 Claim CD Key (Makes NFT Soulbound)"}
              </button>
            )}

            {/* Refund section — only visible while unclaimed and within 14-day window */}
            {selectedTokenId > 0 && !isClaimed && isRefundable && (
              <div className="mb-4">
                {!showRefundInput ? (
                  <button
                    className="btn btn-outline btn-error w-full"
                    onClick={() => setShowRefundInput(true)}
                    disabled={loading}
                  >
                    💸 Request Refund (5% fee retained)
                  </button>
                ) : (
                  <div className="card bg-base-100 p-4 border border-error">
                    <p className="text-sm text-error font-bold mb-2">
                      ⚠️ This will burn your NFT and refund 95% of the payment.
                    </p>
                    <textarea
                      className="textarea textarea-bordered w-full mb-2"
                      placeholder="Reason for refund (optional)"
                      value={refundReason}
                      onChange={e => setRefundReason(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button className="btn btn-error flex-1" onClick={handleRefund} disabled={loading}>
                        {loading ? mintingStep || "Processing..." : "Confirm Refund"}
                      </button>
                      <button
                        className="btn btn-ghost flex-1"
                        onClick={() => setShowRefundInput(false)}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
              <li>Mint your NFT — a CD key is reserved for you on-chain via commitment hash</li>
              <li>
                Claim your CD key within 14 days — encrypted with your MetaMask key, stored on-chain; NFT becomes
                soulbound
              </li>
              <li>Reveal your CD key anytime by decrypting with MetaMask</li>
              <li>Not satisfied? Request a refund within 14 days (before claiming) — 5% fee applies</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
