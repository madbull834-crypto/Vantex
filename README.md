# Vantex Capital

Full-stack EVM implementation of the supplied Vantex Capital brochure: a Solidity stablecoin contract plus a responsive React dashboard.

## Included rules

- Four amount-bound ROI packages. Package rates are 0.50%, 0.55%, 0.60%, and 0.65%; each pays the same percentage again as returned capital. Total Monday–Friday payouts are therefore 1.00%, 1.10%, 1.20%, and 1.30% per earning day. Each position stops at exactly 2× the deposited principal, completing in approximately 200, 182, 167, and 154 earning days.
- ROI-on-ROI commissions apply to claimed ROI. Direct referrals pay 10% to their inviting sponsor at Level 1, including spillover referrals. Indirect commissions follow placement depth and use the rates for Levels 2–15. Each level must be unlocked when the claim is submitted. ROI-mode referral earnings share the existing 3× deposit cap.
- Registration supports `ROI` mode for claimable rewards or `Auto Compound` mode. The permissionless automation entry point processes an opted-in member at most once per Monday–Friday UTC day; an external keeper must submit that daily transaction.
- Team deposits continue to propagate through the binary A/B organization for salary qualification.
- Binary A/B registration with selectable 60/40 or 40/60 volume normalization.
- Salary ranks at $1k/$2k/$5k/$10k/$20k business, paid $25/$50/$125/$250/$500 every 15 days for six cycles.

## BSC Testnet contracts

- Vantex UUPS proxy: `0xb69043907a9573850Df09b756aBEE689CB20D931`
- Current implementation: `0xe1F5DF716ACC296EADe031d52452ca78a36F8580`
- Mock USDT: `0x02E9442E94306f59D2408A8414eFdEbB0d29C4C3`
- Network: BSC Testnet (`97`)

The frontend requests BSC Testnet when a wallet connects. No local blockchain deployment is required.

## Run the frontend

```bash
npm ci
cp .env.example .env
npm run compile
npm test
npm run dev
```

Build the production bundle in `dist/`:

```bash
npm run build
```

To deploy a new UUPS proxy on BSC Testnet, add a funded test-wallet `DEPLOYER_PRIVATE_KEY` to `.env` and run `npm run deploy:testnet`. Leave `PAYMENT_TOKEN` unset to deploy a new MockUSDT, or set it to an existing BSC Testnet token. Never commit `.env`.

To upgrade the existing proxy (for example to add sponsor tracking for "people who joined with my link"), set `DEPLOYER_PRIVATE_KEY` to the **contract owner's** test-wallet key and `VANTEX_PROXY_ADDRESS` to the proxy, then run `npm run upgrade:testnet`. The OpenZeppelin plugin checks storage compatibility before deploying. Members who registered before the sponsor upgrade have no sponsor record; the dashboard treats their placement parent as their sponsor.

To upgrade the implementation while preserving proxy state, set `VANTEX_PROXY_ADDRESS` to the proxy and run `npm run upgrade:testnet`. Only the contract owner can authorize a UUPS upgrade. Keep storage variables append-only across versions and commit the `.openzeppelin/bsc-testnet.json` deployment manifest.

## Important assumptions and risk notes

The source brochure does not specify a blockchain, token, withdrawal policy, or how 60/40 organization volume is calculated. This implementation uses BSC Testnet, a 6-decimal mock stablecoin, caps every position at a 2× payout, and normalizes balanced volume against the selected split. It does not promise solvency or profit; rewards require sufficient token funding. Commission and financial-product rules vary by jurisdiction. Obtain a security audit and legal review before any production deployment.
