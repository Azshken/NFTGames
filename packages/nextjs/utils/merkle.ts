// packages/nextjs/utils/merkle.ts
import { MerkleTree } from "merkletreejs";
import { keccak256 } from "viem";

/**
 * Build a Merkle tree from an array of commitment hashes
 * Hashes should be 64-char hex strings (no 0x prefix) from the DB
 */
export function buildMerkleTree(commitmentHashes: string[]): MerkleTree {
  const leaves = commitmentHashes.map(hash => {
    const withPrefix = hash.startsWith("0x") ? hash : `0x${hash}`;
    // Double-hash: keccak256(keccak256(hash)) — standard OpenZeppelin pattern
    return Buffer.from(keccak256(withPrefix as `0x${string}`).slice(2), "hex");
  });

  return new MerkleTree(
    leaves,
    (data: Buffer) => Buffer.from(keccak256(`0x${data.toString("hex")}` as `0x${string}`).slice(2), "hex"),
    { sortPairs: true },
  );
}

/**
 * Get Merkle root as 0x-prefixed hex string
 */
export function getMerkleRoot(tree: MerkleTree): `0x${string}` {
  return `0x${tree.getRoot().toString("hex")}`;
}

/**
 * Get Merkle proof for a specific commitment hash
 * Returns array of 0x-prefixed hex strings for the contract
 */
export function getMerkleProof(tree: MerkleTree, commitmentHash: string): `0x${string}`[] {
  const withPrefix = commitmentHash.startsWith("0x") ? commitmentHash : `0x${commitmentHash}`;
  const leaf = Buffer.from(keccak256(withPrefix as `0x${string}`).slice(2), "hex");

  return tree.getProof(leaf).map(p => `0x${p.data.toString("hex")}` as `0x${string}`);
}
