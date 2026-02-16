// packages/nextjs/utils/db.ts
import { sql } from "@vercel/postgres";

export interface CDKey {
  id: number;
  encrypted_cdkey: string;
  commitment_hash: string;
  token_id: bigint | null;
  is_redeemed: boolean;
  redeemed_by: string | null;
  created_at: Date;
}

export async function getAvailableCDKey(): Promise<CDKey | null> {
  const result = await sql`
    SELECT id, encrypted_cdkey, commitment_hash
    FROM cdkeys
    WHERE token_id IS NULL
      AND is_redeemed = FALSE
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;

  return result.rows[0] as CDKey | null;
}

export async function linkCDKeyToToken(cdkeyId: number, tokenId: bigint) {
  await sql`
    UPDATE cdkeys
    SET token_id = ${tokenId.toString()}, updated_at = NOW()
    WHERE id = ${cdkeyId}
  `;
}

export async function getCDKeyByTokenId(tokenId: bigint): Promise<CDKey | null> {
  const result = await sql`
    SELECT *
    FROM cdkeys
    WHERE token_id = ${tokenId.toString()}
      AND is_redeemed = FALSE
  `;

  return result.rows[0] as CDKey | null;
}

export async function markCDKeyRedeemed(cdkeyId: number, userAddress: string, txHash: string, ipAddress?: string) {
  // Update CDKey
  await sql`
    UPDATE cdkeys
    SET 
      is_redeemed = TRUE,
      redeemed_by = ${userAddress},
      redeemed_at = NOW(),
      encrypted_cdkey = NULL
    WHERE id = ${cdkeyId}
  `;

  // Log redemption
  await sql`
    INSERT INTO redemption_history (
      cdkey_id, token_id, redeemed_by, tx_hash, ip_address
    )
    SELECT 
      ${cdkeyId},
      token_id,
      ${userAddress},
      ${txHash},
      ${ipAddress || null}::inet
    FROM cdkeys
    WHERE id = ${cdkeyId}
  `;
}
