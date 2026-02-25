<h1 align="center"> SoulKey </h1>

Video game keys represented with NFTs, proving the ownership of the video game. People can connect to the website with their crypto wallet and mint an NFT that represents a claim on video game cdKey.

### Benefits

- Can migrate video games between platforms. NFTs prove that the user bought the game legitimatelly.
- Cannot trade already used/revealed cdKey (Soulbound).
- Revenue shared with developers from the secondary sales (royalty fee).
- People own their games!
- Whole game library in one place.

### How it works

When the owner of the NFT redeems the cdKey the NFT becomes untransferrable (Soulbound) and the cdKey is deleted from the seller's database. The cdKey is encrypted with the NFT owner's publicKey, revealable any time to the owner without exposing the plainTextCdKey.

### The flow

- People can mint an NFT with the hash of the cdKey (claim to the cdKey) -- these NFTs can be used as gifts, or sold on secondary markets (royalty fees apply).
- People can claim the cdKey -- the cdKey gets encrypted with the current NFT owner's publicKey and imprinted onto the NFT; NFT becomes untrasferrable (Soulbound); cdKey is deleted from the seller's database
- Plain text cdKey never gets exposed. It has only the encrypted and hashed versions of the cdKey in the database. It gets decrypted only once when the key is claimed and encrypted right away with the NFT owner's publicKey.

Note:
Correct order of operations:

1. Set ENCRYPTION_KEY in .env.local and Vercel — must be identical
2. Generate CD keys via /admin (admin panel uses the active ENCRYPTION_KEY)
3. Deploy contract, mint NFTs
4. Never rotate ENCRYPTION_KEY without migrating all existing DB records first


## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Solidity, Foundry, OpenZeppelin |
| Frontend | Next.js, Scaffold-ETH 2, RainbowKit, Wagmi, Viem |
| Backend / DB | Next.js API routes, PostgreSQL (Neon) |
| Encryption | AES-256 (server-side), x25519-xsalsa20-poly1305 (MetaMask) |
| Payments | ETH, USDT, USDC |

## Contract

- Network: Ethereum Sepolia testnet
- Standard: ERC-721 + ERC-2981
- License: AGPL-3.0-only

## Local Setup

```bash
# 1. Install dependencies
yarn install

# 2. Copy environment variables
cp .env.example .env.local
# Fill in: ENCRYPTION_KEY, DATABASE_URL, NEXT_PUBLIC_*

# 3. Start local chain
yarn chain

# 4. Deploy contracts (new terminal)
yarn deploy

# 5. Start frontend (new terminal)
yarn start
```
To know more about its features, check out our [website](https://scaffoldeth.io).

## Contributing to Scaffold-ETH 2

We welcome contributions to Scaffold-ETH 2!

Please see [CONTRIBUTING.MD](https://github.com/scaffold-eth/scaffold-eth-2/blob/main/CONTRIBUTING.md) for more information and guidelines for contributing to Scaffold-ETH 2.
