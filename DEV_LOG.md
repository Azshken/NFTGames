START_OF_DEVELOPMENT
- I've had this idea of the NFT game keys in my head for longer time, however I've lacked the expertise to realize it.
I've decided to use Claude Sonnet 4.5(now 4.6) thinking model to help me develop it (It's finally getting usable).
Project development space on [perplexity](https://www.perplexity.ai/search/yarn-start-found-lockfile-miss-PW9.XhYZRzWs0LeW4s1XjA#0).

6/02/2026
- I've set up VSCode + WSL, foundry dev environment,
- developed the first implementation of the smart contract

07/02/2026
- I've set up the deployment on foundry; spun up a wallet; found a testnet with UDST&USDC (Sepolia Arbitrum); I've got some testnet ETH through Alchemy.

8/02/2026
- I'm migrating to desktop PC because the laptop will be slow with Scaffold-ETH-2 (react front end) running.
- I'm creating a new Github repo NFTGames where I'll continue logging and developing the project -- I'm using foundry for smart contract development/testing. Scaffold-ETH-2 as frontend for fast iterations and testing. Vercel as a hosting service with PostgreSQL (neon) as a database.

9/02/2026
- I've developed the front end tested the mint functions

10-15/02/2026
- I was building the database and figuring out how to connect the front end with the database.
- Created pinata account for IPFS hosting for NFT pictures and metadata.

16/02/2026
-Today I've made a functional database for CD keys and I can generate and populate the tables. Recording the time of generation, redemption and tracking is_redeemed (true/false). The CD keys in the database are hashed (for verification) and encrypted for security.
- The front end is running, communicating with the backend (DB) through Vercel and neon serverless database. Previously I could mint from the front end by providing the cdkeyHash. Now I need make it that the hash is coming from the DB as well as the redemption decryption/encryption and modification of the NFT.

17-18/02/2026
Refactoring the code: 
- Implementing merkletrees to prevent frontrunning the minting of the commitmentHashes.
- Removing mintAndClaim function due to security issues -- doing the commitmentHash and the keyEncryption in one transaction
- Renamed DeleteNFT to burn as it fits better to naming conventions
- Added NFT URI. I'm using pinata for IPFS hosting.
- Made some gas optimization changes (pack variables into the same slot)
- Left the Chainlink price feed for the ETH price on later development (using chainlink can complicate things at this stage of development).
- Adjusted the frontend/backend to fit the implementation.
- Reinitialized the code as I'll be working on a laptop, too.

19/02/2026
- I've redeployed the contract on the PC I use different keystore account on PC and the laptop -> I couldn't commit/push the code from laptop without deployment.
- Removed the merkletree safeguard it's redundant. Redeployed the contract and changed the frontend.
