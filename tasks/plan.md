# Solana migration implementation plan

Keep the original checkout untouched. Adapt the existing app, manager/proxy and website in this copy. Keep the existing UI. Require wallet approval; never collect wallet keys. No production or payment success claims before verification.

1. Align x402 SDK versions and pass focused app/manager checks.
2. Verify native MetaMask connection, signing, rejection and session activation. No external checkout page.
3. Add durable payment/fulfillment idempotency and receipts; test retry and failed settlement paths.
4. Implement 3-6 genuinely delivered micro-priced services, priced consistently in app and manager. Do not label duplicate routes as separate services.
5. Provide an agent payment-request tool with bounded, user-approved external x402 purchases. No automatic access to wallet keys.
6. Remove remaining old-chain source, archives, environment examples and public references; update tests and docs.
7. Verify app and website builds, manager tests, and original workspace isolation.
8. Configure the existing production backend only after local checks. Verify receiving USDC account and facilitator setup; ask user to approve an exact real payment for end-to-end proof.

Dependencies: 1 precedes 2-5; verified services precede final pricing copy; 3 and 7 precede live payment test.
Risks: MetaMask peer dependency mismatch; existing unrelated app type errors; payment replay/fulfillment failure; facilitator fees/setup; real-device wallet behavior.
