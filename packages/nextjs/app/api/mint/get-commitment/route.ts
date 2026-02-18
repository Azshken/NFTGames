// packages/nextjs/app/api/mint/get-commitment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getAvailableCDKey } from "~~/utils/db";
import { buildMerkleTree, getMerkleProof } from "~~/utils/merkle";

export async function POST(req: NextRequest) {
  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return NextResponse.json({ error: "Wallet address required" }, { status: 400 });
    }

    // Get available CD key
    const cdkey = await getAvailableCDKey();

    if (!cdkey) {
      return NextResponse.json({ error: "No CD keys available" }, { status: 404 });
    }

    // Fetch ALL unused hashes to rebuild the same Merkle tree
    const allHashes = await sql`
      SELECT commitment_hash FROM cdkeys
      WHERE is_redeemed = FALSE
    `;

    const allCommitmentHashes = allHashes.rows.map(row => row.commitment_hash);

    // Build tree and get proof for this specific hash
    const tree = buildMerkleTree(allCommitmentHashes);
    const merkleProof = getMerkleProof(tree, cdkey.commitment_hash);

    return NextResponse.json({
      success: true,
      commitmentHash: cdkey.commitment_hash,
      cdkeyId: cdkey.id,
      merkleProof,
    });
  } catch (error: any) {
    console.error("Get commitment error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
