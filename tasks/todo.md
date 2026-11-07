# Migration checklist

- [x] SDK alignment: pinned x402 2.30 and Solana Kit 8.6; clean frozen manager install, manager type check and four focused tests pass. Backend production dependency audit reports zero advisories.
- [ ] App wallet/payment slice: native wallet approval, cancellation, signature and receipt verified. Files: app payment/wallet modules and screens. Verify: policy tests, Android export, physical device.
- [ ] Settlement safety: durable idempotency and fulfillment recovery. Verify: duplicate/retry/concurrency tests; no double charge or activation on failed settlement.
- [ ] Paid services: 3-6 distinct delivered services with explicit prices and limits. Verify each operation, charging boundary and failure handling.
- [ ] Agent purchases: controlled x402 request-to-approval tool; verify amount/merchant/network constraints and rejection path.
- [x] Old-chain cleanup: obsolete checkout/worker/archive paths removed in this copy; eleven repository/release checks pass. Original checkout retains only its two preexisting untracked files.
- [ ] Deployment/config: existing backend only; correct public wallet and native USDC; verify facilitator support and receiving token account.
- [ ] Release: current bundle and website builds; real-device test, exact user-approved mainnet payment and session activation; honest demo/README.

Progress already observed: original copy preserved; app Pera checkout callers replaced; old wallet callback routes removed; old backend auto-payment worker removed; Android JS export passed before SDK pin; payment-policy/dependency tests passed; Solana config/challenge tests passed before SDK pin. No actual wallet payment or production cutover verified.

Current priority: get an installable Android preview for Codex and Claude testing. Leave additional agent integrations, autonomous purchases and the demo outside this first device-test checkpoint. The full post-upgrade export hit an optional browser-paywall import in x402 core; its targeted native Babel workaround now passes a real Hermes compiler regression. Full export is rerunning. Existing unrelated app TypeScript errors remain; no claim of a clean full type check or verified native APK.
