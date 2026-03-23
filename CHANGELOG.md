13/03/26

- Added frozen_metadata_cid into the redemptions table
- Added frozenmetadata into confirm/routes.ts
- Added PINATA_JWT to Vercel environments
- Added API route to check for frozen CID first and redirect to IPFS if found
- Fixed the read from attributes products table insertion
- Fixed the app/page ui didn't read the tokens in the wallet

14/03/26

- Fixed the refund issue.
- Deployed a second game contract.

16/03/26

- app/page.tsx new render and handlers - ui overhaul
- Added EIP-4906 support to SoulKey.sol
- Changed the image_cid to image_claimed_cid when building the frozen_metadata (confirm/route.ts)

19/03/26

- utils/db.ts changed so it checks refunds table for available keys.
- Added index: CREATE INDEX idx_cdkeys_batch_created ON cd_keys(batch_id, created_at ASC);
- [tokenID]/route.ts changed the RPC call to DB call.
- Added is_active to products table.
- Added deregister game to /admin page.
- Added a game selector to 'Your Library' section of the app/ page