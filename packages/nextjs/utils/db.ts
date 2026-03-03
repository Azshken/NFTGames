// SPDX-License-Identifier: AGPL-3.0-only
// packages/nextjs/utils/db.ts
import { sql } from "@vercel/postgres";

// ============ Types ============

export interface CDKeyRow {
  id: number;
  encrypted_key: string; // ← was encrypted_cdkey in old schema
  commitment_hash: string;
  batch_id: number;
  created_at: Date;
}

export interface CDKeyWithRedemption extends CDKeyRow {
  wallet_encrypted_cdkey: string | null; // from redemptions table
  redemption_id: number | null;
}

// ============ Product / Batch helpers ============

/**
 * Looks up product_id by contract address. Creates a placeholder product row
 * if none exists — used on first key generation for a new SoulKey contract.
 */
export async function getOrCreateProduct(contractAddress: string, name = "Unknown Game", genre = ""): Promise<number> {
  const existing = await sql`
    SELECT product_id FROM products
    WHERE LOWER(contract_address) = LOWER(${contractAddress})
    LIMIT 1
  `;
  if (existing.rows.length > 0) return existing.rows[0].product_id as number;

  const inserted = await sql`
    INSERT INTO products (contract_address, name, genre, description)
    VALUES (${contractAddress}, ${name}, ${genre}, '')
    RETURNING product_id
  `;
  return inserted.rows[0].product_id as number;
}

export async function createBatch(productId: number, notes: string): Promise<number> {
  const result = await sql`
    INSERT INTO batches (product_id, notes, created_at)
    VALUES (${productId}, ${notes}, NOW())
    RETURNING batch_id
  `;
  return result.rows[0].batch_id as number;
}

export async function insertCDKeys(
  batchId: number,
  keys: { encrypted_key: string; commitment_hash: string }[],
): Promise<void> {
  // Insert one by one — Vercel postgres doesn't support bulk parameterised inserts via tagged template
  for (const key of keys) {
    await sql`
      INSERT INTO cd_keys (batch_id, encrypted_key, commitment_hash, created_at)
      VALUES (${batchId}, ${key.encrypted_key}, ${key.commitment_hash}, NOW())
    `;
  }
}

// ============ Mint helpers ============

/**
 * Returns a cd_key that has no mint record yet, scoped to a specific product
 * (identified by contract_address). Uses SKIP LOCKED for concurrent safety.
 */
export async function getAvailableCDKey(contractAddress: string): Promise<CDKeyRow | null> {
  const result = await sql`
    SELECT ck.id, ck.encrypted_key, ck.commitment_hash, ck.batch_id, ck.created_at
    FROM cd_keys ck
    JOIN batches b ON b.batch_id = ck.batch_id
    JOIN products p ON p.product_id = b.product_id
    WHERE LOWER(p.contract_address) = LOWER(${contractAddress})
      AND NOT EXISTS (SELECT 1 FROM mints m WHERE m.cdkey_id = ck.id)
    ORDER BY ck.created_at ASC
    LIMIT 1
    FOR UPDATE OF ck SKIP LOCKED
  `;
  return (result.rows[0] as CDKeyRow) ?? null;
}

export async function getAvailableKeyCount(contractAddress: string): Promise<number> {
  const result = await sql`
    SELECT COUNT(*) AS cnt
    FROM cd_keys ck
    JOIN batches b ON b.batch_id = ck.batch_id
    JOIN products p ON p.product_id = b.product_id
    WHERE LOWER(p.contract_address) = LOWER(${contractAddress})
      AND NOT EXISTS (SELECT 1 FROM mints m WHERE m.cdkey_id = ck.id)
  `;
  return Number(result.rows[0].cnt);
}

/**
 * Records a successful on-chain mint in the `mints` table.
 * payment_token is address(0) for ETH, or the ERC-20 contract address.
 */
export async function createMint(params: {
  cdkeyId: number;
  tokenId: bigint;
  mintedBy: string;
  mintTxHash: string;
  blockNumber: bigint;
  paymentToken: string;
  paymentAmount: string;
}): Promise<void> {
  await sql`
    INSERT INTO mints (cdkey_id, token_id, minted_by, minted_at, mint_tx_hash, block_number, payment_token, payment_amount)
    VALUES (
      ${params.cdkeyId},
      ${params.tokenId.toString()},
      ${params.mintedBy},
      NOW(),
      ${params.mintTxHash},
      ${params.blockNumber.toString()},
      ${params.paymentToken},
      ${params.paymentAmount}
    )
  `;
}

// ============ Redeem helpers ============

/**
 * Fetches a cd_key row plus its current redemption record (if any)
 * by joining through mints → cd_keys → redemptions.
 */
export async function getCDKeyByTokenId(tokenId: bigint): Promise<CDKeyWithRedemption | null> {
  const result = await sql`
    SELECT
      ck.id,
      ck.encrypted_key,
      ck.commitment_hash,
      ck.batch_id,
      ck.created_at,
      r.wallet_encrypted_cdkey,
      r.redemption_id
    FROM mints m
    JOIN cd_keys ck ON ck.id = m.cdkey_id
    LEFT JOIN redemptions r ON r.cdkey_id = ck.id
    WHERE m.token_id = ${tokenId.toString()}
    LIMIT 1
  `;
  return (result.rows[0] as CDKeyWithRedemption) ?? null;
}

/**
 * Creates an initial redemption record when the server re-encrypts the key
 * for the user — before the on-chain claimCdKey tx is sent.
 * redeemed_by / tx data are filled in by confirmRedemption().
 */
export async function createRedemptionRecord(cdkeyId: number, walletEncryptedCdkey: string): Promise<number> {
  const result = await sql`
    INSERT INTO redemptions (cdkey_id, wallet_encrypted_cdkey)
    VALUES (${cdkeyId}, ${walletEncryptedCdkey})
    ON CONFLICT (cdkey_id) DO UPDATE
      SET wallet_encrypted_cdkey = EXCLUDED.wallet_encrypted_cdkey
    RETURNING redemption_id
  `;
  return result.rows[0].redemption_id as number;
}

/**
 * Finalises the redemption record after claimCdKey tx confirms on-chain.
 * Also deletes the server-side encrypted_key — it is no longer needed.
 */
export async function confirmRedemption(params: {
  cdkeyId: number;
  redeemedBy: string;
  redemptionTxHash: string;
  blockNumber: bigint;
}): Promise<void> {
  await sql`
    UPDATE redemptions
    SET
      redeemed_by    = ${params.redeemedBy},
      redeemed_at    = NOW(),
      redemption_tx_hash = ${params.redemptionTxHash},
      block_number   = ${params.blockNumber.toString()}
    WHERE cdkey_id = ${params.cdkeyId}
  `;

  // Remove server-side plaintext encryption — key now lives on-chain only
  await sql`
    UPDATE cd_keys
    SET encrypted_key = NULL
    WHERE id = ${params.cdkeyId}
  `;
}

// ============ Reserve release helper ============

export async function recordReserveRelease(params: {
  cdkeyId: number;
  releaseReason: "claim" | "expiry";
  txHash: string;
  blockNumber: bigint;
}): Promise<void> {
  await sql`
    INSERT INTO reserve_releases (cdkey_id, release_reason, released_at, tx_hash, block_number)
    VALUES (${params.cdkeyId}, ${params.releaseReason}, NOW(), ${params.txHash}, ${params.blockNumber.toString()})
    ON CONFLICT (tx_hash) DO NOTHING
  `;
}

// ============ Refund helper ============

export async function recordRefund(params: {
  cdkeyId: number;
  refundedBy: string;
  refundReason: string;
  refundTxHash: string;
  blockNumber: bigint;
  paymentToken: string;
  refundedAmount: string;
  feeRetained: string;
}): Promise<void> {
  await sql`
    INSERT INTO refunds (
      cdkey_id, refunded_by, refunded_at, refund_reason,
      refund_tx_hash, block_number, payment_token, refunded_amount, fee_retained
    ) VALUES (
      ${params.cdkeyId},
      ${params.refundedBy},
      NOW(),
      ${params.refundReason},
      ${params.refundTxHash},
      ${params.blockNumber.toString()},
      ${params.paymentToken},
      ${params.refundedAmount},
      ${params.feeRetained}
    )
    ON CONFLICT (cdkey_id) DO NOTHING
  `;
}
