// packages/nextjs/app/admin/page.tsx
"use client";

import { useState } from "react";
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

export default function AdminPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState(10);
  const [adminSecret, setAdminSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  async function generateKeys() {
    if (!adminSecret) {
      notification.error("Please enter admin secret");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/admin/generate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminSecret,
          quantity,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setKeys(data.keys || []);
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

  function downloadHashes() {
    const content = keys.map((k, i) => `${i + 1},${k.commitmentHash}`).join("\n");
    const blob = new Blob([`Index,Commitment Hash\n${content}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commitment-hashes-${Date.now()}.csv`;
    a.click();
    notification.success("Downloaded!");
  }

  function copyAllHashes() {
    const content = keys.map(k => k.commitmentHash).join("\n");
    navigator.clipboard.writeText(content);
    notification.success("Copied all hashes to clipboard!");
  }

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">🔐 Admin Dashboard</h1>
        <p className="text-base-content/70">Generate secure commitment hashes for NFT minting</p>
      </div>

      {/* Info Alert */}
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
          ></path>
        </svg>
        <div className="text-sm">
          <p className="font-bold">How it works:</p>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>CD keys are generated and encrypted server-side</li>
            <li>Only commitment hashes are distributed for minting</li>
            <li>Original CD keys remain encrypted in database</li>
            <li>Users redeem by proving NFT ownership - no plain-text key needed</li>
          </ol>
        </div>
      </div>

      {/* Generation Card */}
      <div className="card bg-base-200 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title">Generate Commitment Hashes</h2>

          <div className="form-control w-full">
            <label className="label">
              <span className="label-text font-semibold">Admin Secret</span>
            </label>
            <div className="join w-full">
              <input
                type={showSecret ? "text" : "password"}
                placeholder="Enter admin secret"
                className="input input-bordered join-item flex-1"
                value={adminSecret}
                onChange={e => setAdminSecret(e.target.value)}
                onKeyPress={e => e.key === "Enter" && generateKeys()}
              />
              <button className="btn join-item" onClick={() => setShowSecret(!showSecret)} type="button">
                {showSecret ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

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
            <button className="btn btn-primary" onClick={generateKeys} disabled={loading || !adminSecret}>
              {loading ? (
                <>
                  <span className="loading loading-spinner"></span>
                  Generating...
                </>
              ) : (
                <>🔑 Generate {quantity} Hashes</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Card */}
      {keys.length > 0 && (
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
              <h2 className="card-title">
                Generated Commitment Hashes <span className="badge badge-primary">{keys.length}</span>
              </h2>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-outline" onClick={copyAllHashes}>
                  📋 Copy All
                </button>
                <button className="btn btn-sm btn-primary" onClick={downloadHashes}>
                  💾 Download CSV
                </button>
              </div>
            </div>

            <div className="alert alert-warning">
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
              <span>
                <strong>Important:</strong> Save these commitment hashes! Users will need them to mint NFTs.
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="table table-zebra table-pin-rows">
                <thead>
                  <tr>
                    <th className="bg-base-200">#</th>
                    <th className="bg-base-200">Commitment Hash</th>
                    <th className="bg-base-200">Actions</th>
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
                            notification.info(`Copied hash #${i + 1}!`);
                          }}
                        >
                          📋 Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stats shadow mt-4">
              <div className="stat">
                <div className="stat-title">Total Generated</div>
                <div className="stat-value text-primary">{keys.length}</div>
                <div className="stat-desc">Commitment hashes ready for distribution</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
