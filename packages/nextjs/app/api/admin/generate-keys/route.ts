// packages/nextjs/app/api/admin/generate-keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { encrypt, generateCDKey, hashCDKey } from "~~/utils/crypto";

export async function POST(req: NextRequest) {
  try {
    const { adminSecret, quantity = 10 } = await req.json();

    // Verify admin access
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const keys = [];

    for (let i = 0; i < quantity; i++) {
      const cdkey = generateCDKey();
      const commitmentHash = hashCDKey(cdkey);
      const encryptedCDKey = encrypt(cdkey);

      await sql`
        INSERT INTO cdkeys (encrypted_cdkey, commitment_hash, is_redeemed)
        VALUES (${encryptedCDKey}, ${commitmentHash}, FALSE)
      `;

      // Only return commitment hash (no plain key!)
      keys.push({ commitmentHash });
    }

    return NextResponse.json({
      success: true,
      count: keys.length,
      keys,
    });
  } catch (error: any) {
    console.error("Generate keys error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
