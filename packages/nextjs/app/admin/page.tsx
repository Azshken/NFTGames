// packages/nextjs/app/admin/page.tsx
"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

// packages/nextjs/app/admin/page.tsx

export default function AdminPage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingRoot, setSettingRoot] = useState(false);
  const [quantity, setQuantity] = useState(10);
  const [merkleRoot, setMerkleRoot] = useState<string>("");
  const [totalHashes, setTotalHashes] = useState<number>(0);
  const [rootTxHash, setRootTxHash] = useState<string>("");

  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "SoulboundNFT",
  });

  async function generateKeys() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/generate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });

      const data = await response.json();

      if (response.ok) {
        setKeys(data.keys || []);
        setMerkleRoot(data.merkleRoot);
        setTotalHashes(data.totalHashes);
        notification.success(`✅ Generated ${data.count} commitment hashes!`);
      } else {
        notification.error(data.error || "Failed to generate keys");
      }
    } catch (error) {
      console.error(error);
      notification.error("Failed to generate keys");
    } finally {
      setLoading(false);
    }
  }

  async function pushMerkleRoot() {
    if (!merkleRoot) {
      notification.error("Generate keys first");
      return;
    }

    setSettingRoot(true);
    try {
      // Admin wallet signs directly — no private key in backend
      const txHash = await writeContractAsync({
        functionName: "setMerkleRoot",
        args: [merkleRoot as `0x${string}`],
      });

      setRootTxHash(txHash as string);
      notification.success("✅ Merkle root pushed to blockchain!");
    } catch (error: any) {
      console.error(error);
      notification.error(`Failed: ${error.message}`);
    } finally {
      setSettingRoot(false);
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

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">🔐 Admin Dashboard</h1>
        <p className="text-base-content/70">Generate CD key batches and manage the Merkle root</p>
      </div>

      {/* Wallet Connection */}
      <div className="card bg-base-200 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title">Admin Wallet</h2>
          <p className="text-sm text-base-content/70 mb-4">
            Connect the wallet that owns the smart contract to push Merkle roots on-chain.
          </p>
          <ConnectButton />
          {isConnected && (
            <div className="alert alert-success mt-4">
              <span className="text-sm font-mono">✅ Connected: {connectedAddress}</span>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="alert alert-info mb-8">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          className="stroke-current shrink-0 w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="text-sm">
          <p className="font-bold">Batch workflow:</p>
          <ol className="list-decimal list-inside mt-1 space-y-1">
            <li>Generate a batch — keys encrypted in DB, Merkle root computed</li>
            <li>Connect the contract owner wallet</li>
            <li>Push Merkle root — your wallet signs the transaction directly</li>
            <li>Users can now mint using any hash from this or previous batches</li>
          </ol>
        </div>
      </div>

      {/* Generate Card */}
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

      {/* Merkle Root Card */}
      {merkleRoot && (
        <div className="card bg-base-100 shadow-xl mb-8 border border-primary">
          <div className="card-body">
            <h2 className="card-title text-primary">🌳 Merkle Root</h2>

            <div className="stats shadow mb-4">
              <div className="stat">
                <div className="stat-title">Total Unredeemed Hashes</div>
                <div className="stat-value text-primary">{totalHashes}</div>
                <div className="stat-desc">Included in this Merkle tree</div>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Merkle Root</span>
              </label>
              <div className="join w-full">
                <input
                  className="input input-bordered join-item flex-1 font-mono text-xs"
                  value={merkleRoot}
                  readOnly
                />
                <button
                  className="btn join-item"
                  onClick={() => {
                    navigator.clipboard.writeText(merkleRoot);
                    notification.info("Copied!");
                  }}
                >
                  📋
                </button>
              </div>
            </div>

            {rootTxHash && (
              <div className="alert alert-success mt-4">
                <span className="text-xs font-mono">✅ On-chain tx: {rootTxHash}</span>
              </div>
            )}

            <div className="alert alert-warning mt-4">
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
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>Connect the contract owner wallet before pushing. Wrong wallet = transaction reverts.</span>
            </div>

            <div className="card-actions justify-end mt-4">
              <button
                className="btn btn-primary btn-lg w-full"
                onClick={pushMerkleRoot}
                disabled={settingRoot || !!rootTxHash || !isConnected}
              >
                {!isConnected ? (
                  "🔌 Connect Owner Wallet First"
                ) : settingRoot ? (
                  <>
                    <span className="loading loading-spinner" />
                    Pushing to Blockchain...
                  </>
                ) : rootTxHash ? (
                  "✅ Root Pushed"
                ) : (
                  "⛓️ Push Merkle Root to Blockchain"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hashes Table */}
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
                    <th className="bg-base-200">Action</th>
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
