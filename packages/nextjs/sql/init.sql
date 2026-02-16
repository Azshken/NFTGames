-- packages/nextjs/sql/init.sql

-- Enable encryption extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Main CDKeys table
CREATE TABLE cdkeys (
  id SERIAL PRIMARY KEY,
  
  -- Encrypted CDKey (AES-256)
  encrypted_cdkey TEXT NOT NULL,
  
  -- Hash stored in NFT (commitment)
  commitment_hash VARCHAR(64) UNIQUE NOT NULL,
  
  -- NFT link
  token_id BIGINT UNIQUE,
  
  -- Status
  is_redeemed BOOLEAN DEFAULT FALSE,
  redeemed_by VARCHAR(42),
  redeemed_at TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_commitment_hash ON cdkeys(commitment_hash);
CREATE INDEX idx_token_id ON cdkeys(token_id) WHERE token_id IS NOT NULL;
CREATE INDEX idx_unredeemed ON cdkeys(is_redeemed) WHERE is_redeemed = FALSE;

-- Redemption history for audit
CREATE TABLE redemption_history (
  id SERIAL PRIMARY KEY,
  cdkey_id INTEGER REFERENCES cdkeys(id),
  token_id BIGINT NOT NULL,
  redeemed_by VARCHAR(42) NOT NULL,
  tx_hash VARCHAR(66),
  redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address INET
);

CREATE INDEX idx_redemption_token ON redemption_history(token_id);
