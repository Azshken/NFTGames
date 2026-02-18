// packages/nextjs/app/api/admin/generate-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";
import { buildMerkleTree, getMerkleRoot } from "~~/utils/merkle";

export async function POST(req: NextRequest) {
  try {
    const { quantity = 10 } = await req.json();

    const keys = [];
    const commitmentHashes: string[] = [];

    // Step 1: Generate keys and insert into DB
    for (let i = 0; i < quantity; i++) {
      const cdkey = generateCDKey();
      const commitmentHash = hashCDKey(cdkey);
      const encryptedCDKey = encrypt(cdkey);

      await sql`
        INSERT INTO cdkeys (encrypted_cdkey, commitment_hash, is_redeemed)
        VALUES (${encryptedCDKey}, ${commitmentHash}, FALSE)
      `;

      commitmentHashes.push(commitmentHash);
      keys.push({ commitmentHash });
    }

    // Step 2: Fetch ALL unused hashes from DB to build complete Merkle tree
    // (includes previously generated batches)
    const allHashes = await sql`
      SELECT commitment_hash FROM cdkeys
      WHERE is_redeemed = FALSE
    `;

    const allCommitmentHashes = allHashes.rows.map(row => row.commitment_hash);

    // Step 3: Build Merkle tree from all valid hashes
    const tree = buildMerkleTree(allCommitmentHashes);
    const merkleRoot = getMerkleRoot(tree);

    return NextResponse.json({
      success: true,
      count: keys.length,
      keys,
      merkleRoot,
      totalHashes: allCommitmentHashes.length,
    });
  } catch (error: any) {
    console.error("Generate keys error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
