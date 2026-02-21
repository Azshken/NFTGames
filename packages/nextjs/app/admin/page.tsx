"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

export default function AdminPage() {
  const router = useRouter();
  const { address: connectedAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [keys, setKeys] = useState<{ commitmentHash: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState(10);
  const [totalAvailable, setTotalAvailable] = useState<number>(0);

  const { data: contractOwner } = useScaffoldReadContract({
    contractName: "SoulboundNFT",
    functionName: "owner",
  });

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
    if (!connectedAddress) return;
    setLoading(true);
    try {
      // Time-bound message prevents replay attacks — valid for 5 minutes
      const timestamp = Date.now();
      const message = `Generate ${quantity} CD keys for SoulboundNFT\nTimestamp: ${timestamp}`;

      const signature = await signMessageAsync({ message });

      const response = await fetch("/api/admin/generate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, walletAddress: connectedAddress, signature, message, timestamp }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();

      if (data.success) {
        setKeys(data.keys || []);
        setTotalAvailable(data.totalAvailable);
        notification.success(`✅ Generated ${data.count} keys!`);
      } else {
        notification.error(data.error || "Failed to generate keys");
      }
    } catch (error: any) {
      // User rejected the signature request in MetaMask
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

  function downloadHashes() {
    const content = keys.map((k, i) => `${i + 1},${k.commitmentHash}`).join("\n");
    const blob = new Blob([`Index,Commitment Hash\n${content}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commitment-hashes-${Date.now()}.csv`;
    a.click();
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
        <p className="text-base-content/70">Generate CD key batches</p>
      </div>

      <div className="alert alert-success mb-8">
        <span className="text-sm font-mono">✅ Owner: {connectedAddress}</span>
      </div>

      <div className="card bg-base-200 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title">Generate New Batch</h2>
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
            />
          </div>
          <div className="stats shadow mt-4">
            <div className="stat">
              <div className="stat-title">Total Unredeemed Keys</div>
              <div className="stat-value text-primary">{totalAvailable}</div>
              <div className="stat-desc">Available for minting</div>
            </div>
          </div>
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
                This Batch <span className="badge badge-primary">{keys.length}</span>
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
