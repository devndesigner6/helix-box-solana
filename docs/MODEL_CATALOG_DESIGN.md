# HelixBox paid model tools: design for approval

Status: approved for implementation by the owner on 2026-11-07. Deployment, real paid tests and funding still require their corresponding authorization.

## Intent and scope

Keep HelixBox's existing mobile workspace and visual language. Codex or Claude Code remains the coding agent and can buy narrowly scoped model assistance, images, or voice output through HelixBox tools. Users approve the spending mandate; agents select a model only inside that mandate. No marketplace, seller onboarding, new landing design, copied reference UI, invented models or copied prices.

The in-app brand is HelixBox. OpenRouter is an upstream backend integration, not a navigation item or customer API requirement. Show truthful model identities and data-handling disclosures; branding does not waive disclosure or upstream terms. The operator funds upstream API credits and keeps the API key only on the existing manager backend. Existing CLI subscriptions/authentication are separate and are not converted into resellable credits.

User reports a successful mainnet payment and manager `200 signed=true`, but return-to-app reconnect is broken. Treat payment as user-reported successful, not end-to-end reconnect verification. Retain the existing wallet fix and its tests. Do not prompt another purchase to recover the same paid session.

## Approaches

1. Exact payment for every bounded model call: useful first verification slice using the working payment rail, but repeated wallet prompts do not satisfy the autonomous target alone.
2. Client-authorized batch settlement with bounded per-call quotes: recommended final target. The user funds a limited channel; a channel-scoped client authorization signs individual cumulative vouchers, with independent per-call and task policy enforcement. Validate delegation and persistence against the installed SDK and MetaMask before committing to it.
3. Server-signed metered channels: not the default. The operator can claim the channel deposit, so server-enforced per-request caps are not equivalent to trustless onchain per-request caps. Requires separate explicit trust approval.

## Proposed flow

Pair workspace -> approve data-sharing scope and spending mandate -> agent reads curated catalog -> obtain binding bounded quote -> reserve budget -> authorize x402 purchase -> execute one upstream operation -> persist result and receipt -> agent uses result -> app displays purchase and remaining budget. Channel claim/distribution and close/refund are tracked separately from the request result.

### Catalog and pricing

- Fetch all live catalog entries and endpoint-level capabilities/prices. Visibility is not a purchasability claim: unsupported/unbounded operations fail before payment. No hardcoded shortlist or invented rates. Cache with a refresh time and recheck the pinned provider's bounded price immediately before dispatch.
- Chat: input/context limit, maximum output/reasoning allowance, bounded tool/add-on policy. Image: count, dimensions, quality and allowed output type. Voice initially means text-to-speech: character/duration and voice/format limits; transcription is not silently included.
- Owner update: fetch all live model entries for the UI; mark unsupported or unpriceable operations unavailable rather than inventing rates. Provider adapters are separate: a chat response parser is not an image/audio adapter.
- Price is quoted per bounded call in native Solana USDC base units. A displayed starting price must specify the corresponding included limits; the complete request receives a final quote before authorization. Never copy the reference screenshot's model names or rates.
- Quote pins model/provider where supported, operation, normalized request hash, unit limits, rate-card version, total price including the disclosed service margin, expiry, network, mint and merchant. Repricing requires a new quote. Do not silently fall back to an expensive or less-private provider.
- Fixed quoted charges do not pretend to equal upstream token cost. Provider usage/cost and customer charge are recorded separately. Margin/rate card requires review before real paid rollout.

### Mandates, authorization and trust

- Bind mandate to owner wallet, authenticated paired client, task and approved model/operation set. Include total budget, maximum per call, maximum number of calls and expiry. A task switch does not inherit authority implicitly.
- Reserve maximum cost atomically across concurrent requests before execution. Count pending/uncertain purchases against available budget. The LLM never authorizes its own limit increase.
- A wallet connection or signed login message is not payment authority. Prove that the user-approved channel limits the actual delegated signer and recipient. Never store the user's wallet seed/private key on the backend or expose signing keys to model prompts.
- Prefer a protected local channel-scoped key when supported, with explicit wallet-approved delegation. If the SDK/wallet cannot support this, stop and report the failed gate; do not substitute a boolean `autoPay` or unrestricted server signer.
- Stop blocks admission of new purchases once acknowledged; already-running work or committed vouchers may still cost money. Channel closure/refund follows protocol timing, not an instant-refund promise.

### Durable purchases and results

- Persist quote, request ID, request hash, payer/mandate/channel, cumulative voucher, upstream request ID, state, customer charge and receipt. Authenticate caller ownership for retries and reads.
- One admitted purchase executes at most once. Concurrent retries cannot reuse a voucher to obtain separate generations. Persist provider result before acknowledging completion. A lost phone connection resumes the same job/result and must not initiate another charge.
- Test crashes at authorization, upstream submission, upstream completion, voucher acceptance and settlement boundaries. An uncertain provider request is reconciled or held; never blindly execute it again.
- Store generated images/audio in access-controlled persistent storage with explicit retention and size limits. Initial proposal: existing manager's durable disk and 24-hour result retention, subject to verified disk availability/capacity; otherwise request a storage choice before deployment. Do not silently provision a paid service.
- Proposed charging policy: cancel before upstream dispatch is free. After dispatch, stopping the agent or disconnecting the phone does not cancel an already-purchased bounded job; complete it and retain the result. Charge the fixed quote only for a completed usable result, even if the user retrieves it later. Partial output or definite upstream technical failure does not earn the full quote; the operator absorbs that upstream cost, releases uncommitted reservations and issues a recoverable refund if money already settled. Uncertain jobs stay reserved until reconciled. Model quality disagreement is not a technical failure. No automatic refund claim until its real settlement path is verified.

### App and agent integration

- Reuse agent panel, wallet settings and existing navigation. Add chat/image/voice catalog filtering, model details, quote, mandate controls, purchase status and result previews. No reference UI clone or separate marketplace.
- Expose discovery, quoting, purchase/result retrieval and budget tools to both Codex and Claude through an authenticated local tool/MCP adapter. A model response alone does not edit files: the coding agent applies the result under its existing permissions.
- Send only user-approved snippets/assets upstream. Deny secret files by default. Restrict generated-file writes to approved workspace-relative paths; block traversal and unsafe executable output.
- Adapt the existing Bun/Hono manager and current CLI transport. No second backend deployment. Validate binary/media limits and failure behavior for the current Render service before enabling image/voice.

## Milestones and definition of done

1. Existing paid-session wallet return reconnects to the same workspace with no extra payment; kill/resume/background scenarios pass on a phone.
2. One real chat call: catalog -> quote -> wallet-approved x402 -> actual model result -> durable receipt/retry recovery.
3. Bounded channel authorization: two real calls after initial wallet approval, independent cap enforcement, persistence across CLI restart, close/refund verification. No autonomous claim before this passes.
4. Both coding agents discover/select/call the tools and use returned work. Tests block unauthorized models, price changes, secrets, concurrency overspend and replay.
5. One real image call and one real TTS call complete the same purchasing path, with authenticated previews and workspace import. No placeholders.
6. Android bundle and relevant app/manager/CLI tests pass, known unrelated errors are disclosed, real payment tests have exact user approval, documentation matches behavior, and only then commit/push/deploy the approved release.

## Decision for the owner

Approved: replace the mandatory $0.25/hour and $2/week agent-access gate with free local workspace/own-CLI access and paid model-tool purchases. Preserve historical receipts and paid session records; do not silently double charge access plus model usage.

## Verified references

- https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- https://openrouter.ai/docs/guides/overview/multimodal/tts
- https://openrouter.ai/pricing
- https://docs.x402.org/schemes/batch-settlement
- Read-only facilitator check on 2026-11-07 advertised Solana mainnet `exact` and `batch-settlement`, not `upto`. Advertisement alone does not verify wallet integration or mainnet channel safety.
