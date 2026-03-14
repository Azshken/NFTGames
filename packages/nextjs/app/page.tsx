// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NextPage } from "next";
import { decodeEventLog, formatEther } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";

import { SOULKEY_ABI, VAULT_ABI } from "~~/utils/abis";
import { notification } from "~~/utils/scaffold-eth";

// ─── Constants ────────────────────────────────────────────────────────────────

const REFUND_WINDOW_SECS = 14 * 24 * 60 * 60;

// NEXT_PUBLIC_ vars are inlined by Next.js at build time.
// Reading once at module level avoids process.env access inside every render cycle.
const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}` | undefined;

// Named constant avoids three independent string literals scattered through the file.
// A typo in any one of them creates a bug that TypeScript cannot catch (type is string).
// Using viem's `zeroAddress` import is an equally valid alternative.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  product_id: number;
  contract_address: `0x${string}`;
  name: string;
  genre: string;
  description: string;
  image_cid: string | null;
};

// Mirrors MasterKeyVault.PaymentRecord:
//   (address paymentToken, uint48 paidAt, uint8 status, uint256 amount, address payer)
// If the Solidity struct field order changes, update this type and the paidAt index below —
// the compiler will surface every usage that breaks.
type PaymentRecord = readonly [`0x${string}`, bigint, number, bigint, `0x${string}`];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensures a hex string is 0x-prefixed AND is exactly 32 bytes (64 hex chars).
 * Throws a descriptive error if the server returned a malformed value —
 * without this guard the failure surfaces as an opaque viem ABI encoding error
 * that gives the user no actionable information.
 */
function toBytes32(hex: string): `0x${string}` {
  const normalized = (hex.startsWith("0x") ? hex : "0x" + hex) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      `Server returned a malformed 32-byte hash: "${normalized}". ` +
        `Expected 0x followed by exactly 64 hex characters.`,
    );
  }
  return normalized;
}

// Second helper. Variable-lenght bytes that validates hex format without
// constraining length:
function toHexBytes(hex: string): `0x${string}` {
  const normalized = (hex.startsWith("0x") ? hex : "0x" + hex) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]*$/.test(normalized)) throw new Error(`Server returned a malformed hex value`);
  return normalized;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // ─── Products ──────────────────────────────────────────────────────────────

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const contractAddress = selectedProduct?.contract_address;

  // Extracted as useCallback so the Retry button can call it directly without a
  // full page reload, which would destroy the user's wallet connection state.
  const loadProducts = useCallback(() => {
    setProductsLoading(true);
    setProductsError(null);
    fetch("/api/products")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.products.length > 0) {
          setProducts(d.products);
          setSelectedProduct(d.products[0]);
        } else {
          setProductsError(d.success ? "No games are available at this time." : (d.error ?? "Failed to load games."));
        }
      })
      .catch(() => setProductsError("Failed to load games. Check your connection and try again."))
      .finally(() => setProductsLoading(false));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // ─── On-chain reads ────────────────────────────────────────────────────────
  //
  // Conditional contracts array — TypeScript only narrows contractAddress to
  // non-undefined inside an inline ternary condition, not through a derived boolean.
  //
  // keepPreviousData is intentionally omitted: showing a stale price from a previous
  // game while the new one loads would allow minting at the wrong price.

  const { data: contractReads, isLoading: contractLoading } = useReadContracts({
    contracts: contractAddress
      ? ([
          { address: contractAddress, abi: SOULKEY_ABI, functionName: "mintPriceETH" as const },
          { address: contractAddress, abi: SOULKEY_ABI, functionName: "mintPriceUSD" as const },
          { address: contractAddress, abi: SOULKEY_ABI, functionName: "totalSupply" as const },
          { address: contractAddress, abi: SOULKEY_ABI, functionName: "maxSupply" as const },
        ] as const)
      : [],
    query: { enabled: !!contractAddress, refetchInterval: 15_000 },
  });

  const mintPriceETH = contractReads?.[0]?.result as bigint | undefined;
  const mintPriceUSD = contractReads?.[1]?.result as bigint | undefined;
  const totalSupply = contractReads?.[2]?.result as bigint | undefined;
  const maxSupply = contractReads?.[3]?.result as bigint | undefined;

  // ─── Token state ───────────────────────────────────────────────────────────

  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<number>(0);
  const [tokensLoading, setTokensLoading] = useState(false);

  // staleTime:0 ensures value is always re-fetched rather than served from cache.
  // wagmi v2 accepts address:undefined when enabled:false — no ! assertion needed.
  const { data: claimTimestamp, refetch: refetchClaimTimestamp } = useReadContract({
    address: contractAddress,
    abi: SOULKEY_ABI,
    functionName: "getClaimTimestamp",
    args: [BigInt(selectedTokenId || 0)],
    query: { enabled: !!contractAddress && selectedTokenId > 0, staleTime: 0 },
  });
  const isClaimed = typeof claimTimestamp === "bigint" && claimTimestamp > 0n;

  // Refund status
  // Inline ternary is required — TypeScript control flow does NOT narrow through a
  // derived boolean variable (e.g. const shouldFetch = !!VAULT_ADDRESS && ...).
  // Only an inline condition propagates the narrowing into the then-branch.
  const { data: refundReads } = useReadContracts({
    contracts:
      VAULT_ADDRESS && contractAddress && selectedTokenId > 0 && !isClaimed
        ? ([
            {
              address: VAULT_ADDRESS,
              abi: VAULT_ABI,
              functionName: "isRefundable" as const,
              args: [contractAddress, BigInt(selectedTokenId)] as const,
            },
            {
              address: VAULT_ADDRESS,
              abi: VAULT_ABI,
              functionName: "paymentRecords" as const,
              args: [contractAddress, BigInt(selectedTokenId)] as const,
            },
          ] as const)
        : [],
    // No query.enabled needed — empty array already prevents any RPC calls.
  });

  const isRefundable = (refundReads?.[0]?.result as boolean | undefined) ?? false;
  
  // TEMP DEBUG — remove after fixing
  console.log("Refund debug:", {
    VAULT_ADDRESS,
    contractAddress,
    selectedTokenId,
    isClaimed,
    refundReads,
    isRefundable,
  });

  // paidAt is typed as bigint | undefined — honest about the undefined case.
  // Previously the code destructured a fallback [] cast as PaymentRecord, which
  // typed paidAt as bigint even when the value was actually undefined at runtime.
  const paymentRecord = refundReads?.[1]?.result as PaymentRecord | undefined;
  const paidAt: bigint | undefined = paymentRecord?.[1];

  const refundWindowExpiry =
    paidAt !== undefined && paidAt > 0n ? new Date((Number(paidAt) + REFUND_WINDOW_SECS) * 1000) : null;

  const refundWindowHoursLeft = refundWindowExpiry
    ? Math.max(0, Math.floor((refundWindowExpiry.getTime() - Date.now()) / 3_600_000))
    : null;

  // ─── Owned tokens ─────────────────────────────────────────────────────────
  //
  // Uses /api/tokens (DB query) instead of getLogs(fromBlock:0n).
  // getLogs with fromBlock:0 breaks on mainnet — most RPC providers cap log queries
  // to ~2000 blocks per request, silently returning empty results on long-running contracts.

  const fetchOwnedTokens = useCallback(async () => {
    if (!connectedAddress || !contractAddress) {
      setOwnedTokens([]);
      setSelectedTokenId(0);
      return;
    }
    setTokensLoading(true);
    try {
      const d = await fetch(`/api/tokens?wallet=${connectedAddress}&contract=${contractAddress}`).then(r => r.json());

      if (d.success) {
        setOwnedTokens(d.tokens);
        // Preserve selection if still valid; otherwise fall back to first token.
        setSelectedTokenId(prev => (d.tokens.includes(prev) ? prev : (d.tokens[0] ?? 0)));
      } else {
        notification.error(`Could not load your tokens: ${d.error ?? "unknown error"}`);
      }
    } catch {
      notification.error("Failed to load your tokens. Please refresh.");
    } finally {
      setTokensLoading(false);
    }
  }, [connectedAddress, contractAddress]);

  // Initial fetch + re-fetch when wallet or game changes.
  // Also resets prevSupplyRef so the supply-change effect below does not double-fire
  // on the first poll tick after a game switch.
  const prevSupplyRef = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    prevSupplyRef.current = undefined;
    fetchOwnedTokens();
  }, [fetchOwnedTokens]);

  // Re-fetch only when totalSupply actually increases (new mint detected on-chain).
  // Avoids hitting the DB on every 15s poll tick regardless of whether anything changed.
  useEffect(() => {
    if (totalSupply === undefined) return;
    if (prevSupplyRef.current !== undefined && totalSupply > prevSupplyRef.current) {
      fetchOwnedTokens();
    }
    prevSupplyRef.current = totalSupply;
  }, [totalSupply, fetchOwnedTokens]);

  // ─── UI state ──────────────────────────────────────────────────────────────

  const [selectedPayment, setSelectedPayment] = useState<"ETH" | "USDT" | "USDC">("ETH");
  const [revealedKey, setRevealedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [mintingStep, setMintingStep] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [showRefundInput, setShowRefundInput] = useState(false);

  // Reset UI-only state on game or token switch.
  // Data state is managed by wagmi hooks and fetchOwnedTokens — not reset here.
  useEffect(() => {
    setRevealedKey("");
    setShowRefundInput(false);
  }, [contractAddress]);
  useEffect(() => {
    setRevealedKey("");
    setShowRefundInput(false);
  }, [selectedTokenId]);

  // ─── Mint ─────────────────────────────────────────────────────────────────

  const handleMint = async () => {
    if (!connectedAddress || !contractAddress) {
      notification.error("Please connect your wallet");
      return;
    }
    // mintPriceETH === undefined means data hasn't loaded yet — NOT the same as 0n.
    // Checking === undefined correctly handles free-mint contracts (mintPriceETH === 0n).
    if (mintPriceETH === undefined || mintPriceUSD === undefined) {
      notification.error("Contract data is still loading — please wait a moment");
      return;
    }
    // Explicit guard — no ! assertion. publicClient is undefined during SSR or if wagmi
    // is misconfigured; a runtime crash here would lose the user's committed key reservation.
    if (!publicClient) {
      notification.error("No RPC client available — please refresh the page");
      return;
    }

    setLoading(true);
    setMintingStep("Getting commitment hash from database...");
    try {
      const commitRes = await fetch("/api/mint/get-commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: connectedAddress, contractAddress }),
      });
      const commitData = await commitRes.json();
      if (!commitData.success) throw new Error(commitData.error ?? "Failed to get commitment hash");

      // toBytes32 validates that the server returned a well-formed 32-byte hash.
      // Without this check a malformed hash from the server produces an opaque
      // viem ABI encoding error with no actionable message for the user.
      const commitHashBytes32 = toBytes32(commitData.commitmentHash);

      setMintingStep(`Minting NFT with ${selectedPayment}...`);

      // Explicit if/else branches are required here.
      // wagmi's writeContractAsync has strict generic types where functionName must be a
      // literal type inferred from the ABI. A computed string variable widens to string
      // and produces a TypeScript compile error.
      let txHash: `0x${string}`;
      if (selectedPayment === "ETH") {
        txHash = await writeContractAsync({
          address: contractAddress,
          abi: SOULKEY_ABI,
          functionName: "mintWithETH",
          args: [commitHashBytes32],
          value: mintPriceETH,
        });
      } else if (selectedPayment === "USDT") {
        txHash = await writeContractAsync({
          address: contractAddress,
          abi: SOULKEY_ABI,
          functionName: "mintWithUSDT",
          args: [commitHashBytes32],
        });
      } else {
        txHash = await writeContractAsync({
          address: contractAddress,
          abi: SOULKEY_ABI,
          functionName: "mintWithUSDC",
          args: [commitHashBytes32],
        });
      }

      setMintingStep("Waiting for transaction confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Decode using SOULKEY_ABI — no inline parseAbi, consistent with abis.ts.
      let tokenId: bigint | undefined;
      let mintedPaymentToken: string = ZERO_ADDRESS;
      for (const log of receipt.logs) {
        try {
          const d = decodeEventLog({
            abi: SOULKEY_ABI,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
          });
          if (d.args.from === ZERO_ADDRESS) tokenId = d.args.tokenId;
        } catch {}
        try {
          const d = decodeEventLog({
            abi: SOULKEY_ABI,
            eventName: "NFTMinted",
            data: log.data,
            topics: log.topics,
          });
          mintedPaymentToken = d.args.paymentToken as string;
        } catch {}
      }
      if (!tokenId) throw new Error("Could not extract token ID from transaction");
      const mintedTokenId = tokenId; // const — type is bigint, never re-widened across awaits

      setMintingStep("Linking token to database...");
      const linkRes = await fetch("/api/mint/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: mintedTokenId.toString(),
          walletAddress: connectedAddress,
          txHash,
          blockNumber: receipt.blockNumber.toString(),
          paymentToken: mintedPaymentToken,
          paymentAmount: selectedPayment === "ETH" ? mintPriceETH!.toString() : mintPriceUSD!.toString(),
          contractAddress,
          commitmentHash: commitData.commitmentHash,
        }),
      });
      const linkData = await linkRes.json();

      if (!linkData.success) {
        // The on-chain mint succeeded — the user's NFT and payment are safe.
        // Only the DB record failed. Do NOT call fetchOwnedTokens() here:
        // the DB doesn't have this token so the query would return without it,
        // leaving the user unable to access their NFT for the entire session
        // (and even after a refresh, since the DB remains inconsistent).
        //
        // Instead, inject the token optimistically — its existence was confirmed
        // from the on-chain receipt above, not assumed. This is an intentional
        // exception to the no-optimistic-update policy.
        notification.warning(
          `NFT minted on-chain (tx: ${txHash.slice(0, 10)}…) but the server record failed ` +
            `— please contact support with your transaction hash.`,
        );
        setOwnedTokens(prev => (prev.includes(Number(mintedTokenId)) ? prev : [...prev, Number(mintedTokenId!)]));
        setSelectedTokenId(Number(mintedTokenId));
        return;
      }

      // DB is now consistent — fetch authoritative state.
      // No optimistic update: avoids a race condition where a polling-triggered
      // fetchOwnedTokens fires before link-token completes and wipes the new token.
      await fetchOwnedTokens();
      setSelectedTokenId(Number(mintedTokenId));
      notification.success(`NFT minted! Token #${mintedTokenId} — now claim your CD key.`);
    } catch (error: any) {
      console.error("Mint error", error);
      notification.error(`Failed to mint: ${error.message}`);
    } finally {
      setLoading(false);
      setMintingStep("");
    }
  };

  // ─── Claim CD Key ─────────────────────────────────────────────────────────

  const handleClaimCDKey = async () => {
    if (!connectedAddress || !selectedTokenId || !contractAddress) {
      notification.error("Please select a token");
      return;
    }
    if (isClaimed) {
      notification.error("This token's CD key has already been claimed");
      return;
    }
    if (!publicClient) {
      notification.error("No RPC client available — please refresh the page");
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
        body: JSON.stringify({
          tokenId: selectedTokenId,
          userAddress: connectedAddress,
          userPublicKey,
          contractAddress,
        }),
      });
      const redeemData = await redeemRes.json();
      if (!redeemData.success) throw new Error(redeemData.error ?? "Failed to retrieve CD key");

      setMintingStep("Claiming CD key on blockchain...");
      const txHash = await writeContractAsync({
        address: contractAddress,
        abi: SOULKEY_ABI,
        functionName: "claimCdKey",
        args: [
          BigInt(selectedTokenId),
          toBytes32(redeemData.commitmentHash), // bytes32 — fixed length ✓
          toHexBytes(redeemData.encryptedCDKey), // bytes   — variable length ✓
        ],
      });

      setMintingStep("Confirming redemption...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      await fetch("/api/redeem/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cdkeyId: redeemData.cdkeyId,
          userAddress: connectedAddress,
          txHash,
          blockNumber: receipt.blockNumber.toString(),
          contractAddress,
          tokenId: selectedTokenId.toString(),
        }),
      });

      await refetchClaimTimestamp();
      notification.success("CD key claimed! NFT is now soulbound. Click 'Reveal CD Key' to decrypt.");
    } catch (error: any) {
      console.error("Claim error", error);
      notification.error(`Failed to claim: ${error.message}`);
    } finally {
      setLoading(false);
      setMintingStep("");
    }
  };

  // ─── Reveal CD Key ────────────────────────────────────────────────────────

  const handleRevealCDKey = async () => {
    if (!connectedAddress || !selectedTokenId || !contractAddress) {
      notification.error("Please connect your wallet and select a token");
      return;
    }
    if (!isClaimed) {
      notification.error("CD key hasn't been claimed yet");
      return;
    }
    if (!publicClient) {
      notification.error("No RPC client available — please refresh the page");
      return;
    }

    setLoading(true);
    setMintingStep("Retrieving encrypted CD key from blockchain...");
    try {
      const encryptedBytes = (await publicClient.readContract({
        address: contractAddress,
        abi: SOULKEY_ABI,
        functionName: "getEncryptedCDKey",
        args: [BigInt(selectedTokenId)],
        account: connectedAddress as `Ox${string}`,
      })) as `0x${string}`;

      if (!encryptedBytes || encryptedBytes === "0x") {
        throw new Error("No encrypted CD key found on-chain");
      }

      setMintingStep("Decrypting with your MetaMask private key...");
      const decrypted = await (window as any).ethereum.request({
        method: "eth_decrypt",
        params: [encryptedBytes, connectedAddress],
      });
      setRevealedKey(decrypted);
      notification.success("CD key revealed successfully!");
    } catch (error: any) {
      console.error("Reveal error", error);
      notification.error(`Failed to reveal: ${error.message}`);
    } finally {
      setLoading(false);
      setMintingStep("");
    }
  };

  // ─── Refund ───────────────────────────────────────────────────────────────

  const handleRefund = async () => {
    if (!connectedAddress || !selectedTokenId || !contractAddress || !VAULT_ADDRESS) {
      notification.error("Wallet or contract not ready");
      return;
    }
    if (!isRefundable) {
      notification.error("This token is not refundable");
      return;
    }
    if (!publicClient) {
      notification.error("No RPC client available — please refresh the page");
      return;
    }

    setLoading(true);
    setMintingStep("Processing refund on blockchain...");
    try {
      const reason = refundReason || "User requested refund";
      const txHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "processRefund",
        args: [contractAddress, BigInt(selectedTokenId), reason],
      });

      setMintingStep("Waiting for refund confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      let refundedAmount = "0",
        feeRetained = "0",
        paymentToken: string = ZERO_ADDRESS;
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
        } catch {}
      }

      await fetch("/api/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractAddress,
          tokenId: selectedTokenId.toString(),
          refundedBy: connectedAddress,
          refundReason: reason,
          refundTxHash: txHash,
          blockNumber: receipt.blockNumber.toString(),
          paymentToken,
          refundedAmount,
          feeRetained,
        }),
      });

      // Fetch authoritative DB state — the refunds row now exists so token is excluded.
      await fetchOwnedTokens();
      setShowRefundInput(false);
      setRefundReason(""); // clear so the next token starts with an empty textarea
      notification.success("Refund processed! NFT has been burned.");
    } catch (error: any) {
      console.error("Refund error", error);
      notification.error(`Refund failed: ${error.message}`);
    } finally {
      setLoading(false);
      setMintingStep("");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-4">
        <span className="loading loading-spinner loading-lg" />
        <p className="text-base-content/70">Loading games...</p>
      </div>
    );
  }

  if (productsError) {
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-4">
        <div className="alert alert-error max-w-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{productsError}</span>
        </div>
        {/* loadProducts() re-runs the fetch without destroying wallet state */}
        <button className="btn btn-outline" onClick={loadProducts}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-4xl">
        <h1 className="text-center">
          <span className="block text-4xl font-bold mb-8">SoulKey</span>
        </h1>
        <p className="subtitle flex items-center font-medium">Virtual Game Keys</p>

        {/* Contract address */}
        <div className="flex justify-center items-center flex-col mb-8">
          <p className="my-2 font-medium">Contract Address</p>
          <span className="font-mono text-sm break-all">{contractAddress}</span>
        </div>

        {/* Game selector — only rendered when there are multiple products */}
        {products.length > 1 && (
          <div className="flex justify-center gap-4 mb-8 flex-wrap">
            {products.map(selectedProduct => (
              <div
                key={selectedProduct.product_id}
                className={`card bg-base-100 shadow-xl cursor-pointer border-2 transition-colors ${
                  selectedProduct?.product_id === selectedProduct.product_id ? "border-primary" : "border-transparent"
                }`}
                onClick={() => setSelectedProduct(selectedProduct)}
              >
                {selectedProduct.image_cid && (
                  <figure className="px-6 pt-6">
                    <Image
                      src={`https://gateway.pinata.cloud/ipfs/${selectedProduct.image_cid}`}
                      alt={selectedProduct.name}
                      width={384}
                      height={192}
                      className="rounded-xl object-cover w-full"
                    />
                  </figure>
                )}
                <div className="card-body items-center text-center py-4 px-6">
                  <h2 className="card-title text-base">{selectedProduct.name}</h2>
                  <p className="text-xs text-base-content/70">{selectedProduct.genre}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Supply & price — min-h prevents layout shift while data loads */}
        <div className="text-center mb-4 min-h-[3.5rem]">
          {contractLoading ? (
            <span className="loading loading-dots loading-sm" />
          ) : (
            <>
              <p className="text-lg">
                Supply: {totalSupply?.toString() ?? "—"} / {maxSupply?.toString() ?? "—"}
              </p>
              <p className="text-lg mt-1">
                Price: {mintPriceETH !== undefined ? formatEther(mintPriceETH) : "—"} ETH or{" "}
                {mintPriceUSD !== undefined ? (Number(mintPriceUSD) / 1e6).toFixed(2) : "—"} USDC/USDT
              </p>
            </>
          )}
        </div>

        {/* Game card */}
        {selectedProduct && (
          <div className="flex justify-center mb-8">
            <div className="card bg-base-100 shadow-xl max-w-sm w-full">
              {selectedProduct.image_cid && (
                <figure className="px-6 pt-6">
                  <Image
                    src={`https://gateway.pinata.cloud/ipfs/${selectedProduct.image_cid}`}
                    alt={selectedProduct.name}
                    width={384}
                    height={192}
                    className="rounded-xl object-cover w-full"
                  />
                </figure>
              )}
              <div className="card-body items-center text-center">
                <h2 className="card-title">{selectedProduct.name}</h2>
                <p className="text-sm text-base-content/70">{selectedProduct.genre}</p>
                {selectedProduct.description && <p className="text-sm">{selectedProduct.description}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Payment method */}
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

        {/* Mint — also disabled during contractLoading to prevent stale-price mint */}
        <div className="flex justify-center mb-8">
          <button
            className="btn btn-primary btn-lg w-full max-w-md"
            onClick={handleMint}
            disabled={loading || !connectedAddress || !contractAddress || mintPriceETH === undefined || contractLoading}
          >
            {loading && mintingStep ? mintingStep : `Mint NFT with ${selectedPayment}`}
          </button>
        </div>

        {/* Owned tokens */}
        {tokensLoading ? (
          <div className="flex justify-center mb-8">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : ownedTokens.length > 0 ? (
          <div className="card bg-base-200 shadow-xl p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Your NFTs &amp; CD Keys</h2>

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
                      Refund window: {refundWindowHoursLeft}h left
                    </span>
                  )}
                </label>
              )}
            </div>

            {/* Claim */}
            {selectedTokenId > 0 && !isClaimed && (
              <button
                className="btn btn-accent w-full mb-4"
                onClick={handleClaimCDKey}
                disabled={loading || !connectedAddress}
              >
                {loading ? mintingStep || "Processing..." : "Claim CD Key (Makes NFT Soulbound)"}
              </button>
            )}

            {/* Refund */}
            {selectedTokenId > 0 && !isClaimed && isRefundable && (
              <div className="mb-4">
                {!showRefundInput ? (
                  <button
                    className="btn btn-outline btn-error w-full"
                    onClick={() => setShowRefundInput(true)}
                    disabled={loading}
                  >
                    Request Refund (5% fee retained)
                  </button>
                ) : (
                  <div className="card bg-base-100 p-4 border border-error">
                    <p className="text-sm text-error font-bold mb-2">
                      This will burn your NFT and refund 95% of the payment.
                    </p>
                    <textarea
                      className="textarea textarea-bordered w-full mb-2"
                      placeholder="Reason for refund (optional)"
                      value={refundReason}
                      onChange={e => setRefundReason(e.target.value)}
                      rows={2}
                      maxLength={280}
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

            {/* Reveal */}
            {selectedTokenId > 0 && isClaimed && (
              <>
                <div className="divider">Your CD Key</div>
                <button
                  className="btn btn-info w-full mb-4"
                  onClick={handleRevealCDKey}
                  disabled={loading || !connectedAddress}
                >
                  {loading ? mintingStep || "Processing..." : "Reveal CD Key"}
                </button>
                {revealedKey && (
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-bold">Your Game CD Key</span>
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
                          notification.success("Copied!");
                        }}
                      >
                        Copy Key
                      </button>
                    </div>
                    <label className="label">
                      <span className="label-text-alt text-warning">
                        This key is unique and can only be used once. Keep it safe!
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {/* How it works */}
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
            <h3 className="font-bold">How it works</h3>
            <ol className="text-xs list-decimal list-inside space-y-1 mt-1">
              <li>Mint your NFT — a CD key is reserved for you on-chain via commitment hash</li>
              <li>Claim your CD key — encrypted with your MetaMask key, stored on-chain; NFT becomes soulbound</li>
              <li>Reveal your CD key anytime by decrypting with MetaMask</li>
              <li>Not satisfied? Request a refund within 14 days before claiming — 5% fee applies</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
