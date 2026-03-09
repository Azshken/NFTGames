// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/app/admin/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useReadContract, useSignMessage, useWriteContract } from "wagmi";

import { SOULKEY_ABI, VAULT_ABI } from "~~/utils/abis";
import { notification } from "~~/utils/scaffold-eth";

// Explicitly declared contract address
const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}` | undefined;

export default function AdminPage() {
  const router = useRouter();
  const { address: connectedAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const { writeContractAsync: writeVaultContract } = useWriteContract();

  const [keys, setKeys] = useState<{ commitmentHash: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState(10);
  const [batchNotes, setBatchNotes] = useState("");
  const [totalAvailable, setTotalAvailable] = useState<number>(0);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [regContractAddress, setRegContractAddress] = useState("");
  const [regGameName, setRegGameName] = useState("");
  const [regGenre, setRegGenre] = useState("");
  const [regDescription, setRegDescription] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regStatus, setRegStatus] = useState<string>("");
  const [genContractAddress, setGenContractAddress] = useState<string>("");

  // Only the owner of the VAULT_ADDRESS has access to the /admin page
  const { data: contractOwner, isLoading: ownerLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "owner",
    query: { enabled: !!VAULT_ADDRESS },
  });

  // No Pre-fill, admin types the SoulKey address manually.
  // Multiple SoulKey addresses exist.

  useEffect(() => {
    if (isConnected && contractOwner && connectedAddress) {
      if (contractOwner.toLowerCase() !== connectedAddress.toLowerCase()) {
        notification.error("Access denied: not the contract owner");
        router.push("/");
      }
    }
  }, [contractOwner, connectedAddress, isConnected, router]);

  const isOwner =
    isConnected && contractOwner && connectedAddress && contractOwner.toLowerCase() === connectedAddress.toLowerCase();

  async function generateKeys() {
    if (!connectedAddress) {
      notification.error("Please connect your wallet");
      return;
    }
    if (!genContractAddress || !/^0x[0-9a-fA-F]{40}$/.test(genContractAddress)) {
      notification.error("Invalid contract address format");
      return;
    }
    setLoading(true);
    try {
      const timestamp = Date.now();
      // ← message updated to match SoulKey contract name
      const message = `Generate ${quantity} CD keys for SoulKey\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ message });

      const response = await fetch("/api/admin/generate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          walletAddress: connectedAddress,
          contractAddress: genContractAddress, // ← passed so backend can look up the product
          batchNotes,
          signature,
          message,
          timestamp,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      if (data.success) {
        setKeys(data.keys || []);
        setTotalAvailable(data.totalAvailable);
        setBatchId(data.batchId);
        notification.success(`✅ Generated ${data.count} keys in batch #${data.batchId}!`);
      } else {
        notification.error(data.error || "Failed to generate keys");
      }
    } catch (error: any) {
      if (error?.code === 4001 || error?.message?.includes("rejected")) {
        notification.error("Signature rejected — no keys generated");
      } else {
        console.error(error);
        notification.error(error.message || "Failed to generate keys");
      }
    } finally {
      setLoading(false);
    }
  }

  async function registerGame() {
    if (!connectedAddress || !regContractAddress || !regGameName) {
      notification.error("Contract address and game name are required");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(regContractAddress)) {
      notification.error("Invalid contract address");
      return;
    }
    if (!publicClient) {
      notification.error("No RPC client available — please refresh the page");
      return;
    }

    setRegLoading(true);
    setRegStatus("Checking on-chain registration...");
    try {
      // Read vault address from the SoulKey contract
      const vaultAddress = await publicClient.readContract({
        address: regContractAddress as `0x${string}`,
        abi: SOULKEY_ABI,
        functionName: "vault",
      });

      // Check if already registered in vault
      const isRegistered = await publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: "registeredGames",
        args: [regContractAddress as `0x${string}`],
      });

      // NOTE: writeVaultContract here requires msg.sender to be the MasterKeyVault owner,
      // which must be the same wallet as the SoulKey owner. If these diverge in future,
      // the vault owner must call registerGame() separately.
      // Call vault.registerGame() if not yet registered (e.g. initial deployment)
      if (!isRegistered) {
        setRegStatus("Registering contract with MasterKeyVault...");
        const txHash = await writeVaultContract({
          address: vaultAddress as `0x${string}`,
          abi: VAULT_ABI,
          functionName: "registerGame",
          args: [regContractAddress as `0x${string}`],
        });
        setRegStatus("Waiting for confirmation...");
        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      }

      setRegStatus("Saving product to database...");
      const timestamp = Date.now();
      const message = `Register game ${regContractAddress} in SoulKey\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/admin/register-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: connectedAddress,
          contractAddress: regContractAddress,
          gameName: regGameName,
          genre: regGenre,
          description: regDescription,
          signature,
          message,
          timestamp,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      notification.success(`✅ "${data.product.name}" registered! Product ID: ${data.product.product_id}`);
      setRegStatus("");
      setRegContractAddress("");
      setRegGameName("");
      setRegGenre("");
      setRegDescription("");
    } catch (error: any) {
      if (error?.code === 4001 || error?.message?.includes("rejected")) {
        notification.error("Signature rejected");
      } else {
        notification.error(error.message || "Registration failed");
      }
      setRegStatus("");
    } finally {
      setRegLoading(false);
    }
  }

  function downloadHashes() {
    const content = keys.map((k, i) => `${i + 1},${k.commitmentHash}`).join("\n");
    const blob = new Blob([`Index,Commitment Hash\n${content}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commitment-hashes-batch${batchId ?? "unknown"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-3xl font-bold">🔐 Admin Dashboard</h1>
        <p className="text-base-content/70">Connect the contract owner wallet to continue</p>
        <ConnectButton />
      </div>
    );
  }

  if (isConnected && ownerLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <span className="loading loading-spinner loading-lg" />
        <p className="text-base-content/70">Verifying ownership...</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-3xl font-bold text-error">Access Denied</h1>
        <p className="text-base-content/70 font-mono text-sm">{connectedAddress}</p>
        <p>This wallet is not the contract owner.</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">🔐 Admin Dashboard</h1>
        <p className="text-base-content/70">Generate CD key batches for SoulKey</p>
      </div>

      <div className="alert alert-success mb-8">
        <span className="text-sm font-mono">✅ Owner: {connectedAddress}</span>
        {VAULT_ADDRESS && <span className="text-sm font-mono ml-4">📄 Vault: {VAULT_ADDRESS}</span>}
      </div>

      <div className="card bg-base-200 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title">Register Game Contract</h2>
          <p className="text-sm text-base-content/70">
            Use this for the initial deployment contract (which has no DB entry) or for any new SoulKey deployed via the
            Foundry script.
          </p>

          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-semibold">SoulKey Contract Address</span>
            </label>
            <input
              type="text"
              className="input input-bordered font-mono w-full"
              placeholder="0x..."
              value={regContractAddress}
              onChange={e => setRegContractAddress(e.target.value)}
              disabled={regLoading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text font-semibold">Game Name *</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="e.g. Fallout"
                value={regGameName}
                onChange={e => setRegGameName(e.target.value)}
                disabled={regLoading}
              />
            </div>
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text font-semibold">Genre</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="e.g. RPG, FPS..."
                value={regGenre}
                onChange={e => setRegGenre(e.target.value)}
                disabled={regLoading}
              />
            </div>
          </div>

          <div className="form-control w-full mt-2">
            <label className="label">
              <span className="label-text font-semibold">Description</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              placeholder="Short game description..."
              rows={2}
              value={regDescription}
              onChange={e => setRegDescription(e.target.value)}
              disabled={regLoading}
            />
          </div>

          {regStatus && (
            <div className="alert alert-info mt-2 py-2" role="status" aria-live="polite">
              <span className="loading loading-spinner loading-sm" />
              <span className="text-sm">{regStatus}</span>
            </div>
          )}

          <div className="card-actions justify-end mt-4">
            <button
              className="btn btn-secondary"
              onClick={registerGame}
              disabled={regLoading || !regContractAddress || !regGameName}
            >
              {regLoading ? (
                <>
                  <span className="loading loading-spinner" />
                  Registering...
                </>
              ) : (
                <>📋 Register Game</>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title">Generate New Batch</h2>

          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-semibold">SoulKey Contract Address</span>
            </label>
            <input
              type="text"
              className="input input-bordered font-mono w-full"
              placeholder="0x... (defaults to deployed contract)"
              value={genContractAddress}
              onChange={e => setGenContractAddress(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control w-full">
              <label className="label">
                <span className="label-text font-semibold">Quantity</span>
                <span className="label-text-alt">Max: 1000</span>
              </label>
              <input
                type="number"
                min="1"
                max="1000"
                className="input input-bordered w-full"
                value={quantity}
                onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                disabled={loading}
              />
            </div>

            <div className="form-control w-full">
              <label className="label">
                <span className="label-text font-semibold">Batch Notes</span>
                <span className="label-text-alt">Optional</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="e.g. Launch batch, promo batch..."
                value={batchNotes}
                onChange={e => setBatchNotes(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="stats shadow mt-4">
            <div className="stat">
              <div className="stat-title">Total Unminted Keys</div>
              <div className="stat-value text-primary">{totalAvailable}</div>
              <div className="stat-desc">Available for minting</div>
            </div>
            {batchId && (
              <div className="stat">
                <div className="stat-title">Last Batch ID</div>
                <div className="stat-value text-secondary">#{batchId}</div>
                <div className="stat-desc">{keys.length} keys generated</div>
              </div>
            )}
          </div>

          <label className="label">
            <span className="label-text-alt text-warning">⚠️ Product must be registered before generating keys</span>
          </label>

          <div className="card-actions justify-end mt-4">
            <button className="btn btn-primary" onClick={generateKeys} disabled={loading}>
              {loading ? (
                <>
                  <span className="loading loading-spinner" />
                  Generating...
                </>
              ) : (
                <>🔑 Generate {quantity} Keys</>
              )}
            </button>
          </div>
        </div>
      </div>

      {keys.length > 0 && (
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex justify-between items-center mb-4">
              <h2 className="card-title">
                Batch #{batchId} <span className="badge badge-primary">{keys.length}</span>
              </h2>
              <button className="btn btn-sm btn-outline" onClick={downloadHashes}>
                💾 Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table table-zebra table-pin-rows">
                <thead>
                  <tr>
                    <th className="bg-base-200">#</th>
                    <th className="bg-base-200">Commitment Hash</th>
                    <th className="bg-base-200">Copy</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key, i) => (
                    <tr key={i} className="hover">
                      <td className="font-bold">{i + 1}</td>
                      <td className="font-mono text-xs">{key.commitmentHash}</td>
                      <td>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(key.commitmentHash);
                            notification.info(`Copied #${i + 1}!`);
                          }}
                        >
                          📋
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
