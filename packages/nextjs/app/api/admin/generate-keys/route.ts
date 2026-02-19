// packages/nextjs/app/api/admin/generate-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";

export async function POST(req: NextRequest) {
  // Simple secret header check — protects the endpoint without a private key
  const adminSecret = req.headers.get("x-admin-secret");
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { quantity = 10 } = await req.json();

    const keys = [];

    for (let i = 0; i < quantity; i++) {
      const cdkey = generateCDKey();
      const commitmentHash = hashCDKey(cdkey);
      const encryptedCDKey = encrypt(cdkey);

      await sql`
        INSERT INTO cdkeys (encrypted_cdkey, commitment_hash, is_redeemed)
        VALUES (${encryptedCDKey}, ${commitmentHash}, FALSE)
      `;

      keys.push({ commitmentHash });
    }

    const allHashes = await sql`
      SELECT commitment_hash FROM cdkeys
      WHERE is_redeemed = FALSE
    `;

    return NextResponse.json({
      success: true,
      count: keys.length,
      keys,
      totalHashes: allHashes.rows.length,
    });
  } catch (error: any) {
    console.error("Generate keys error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
