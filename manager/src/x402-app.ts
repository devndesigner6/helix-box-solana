import { Hono, type Context } from 'hono';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { paymentMiddleware } from '@x402/hono';
import { decodePaymentResponseHeader } from '@x402/core/http';
import {
  CLI_HOURLY_PRICE_USDC, CLI_HOURLY_ROUTE,
  PREMIUM_WEEKLY_PRICE_USDC, PREMIUM_WEEKLY_ROUTE,
  AGENT_SESSION_1HOUR_PRICE_USDC, AGENT_SESSION_1HOUR_ROUTE,
  CODEX_AGENT_ROUTE, type X402Config,
} from './x402-payment.ts';

export interface PurchasedSession { code: string; expiresAt: number }
type PaymentEnv = { Variables: { purchase: PurchasedSession | undefined } };
interface X402AppOptions {
  config: X402Config;
  redeemSession: (code: string, expiresAt: number, paymentId: string) => Promise<PurchasedSession>;
  sessionExists: (code: string) => boolean;
}

export function createX402App({ config, redeemSession, sessionExists }: X402AppOptions) {
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(config.network, new ExactSvmScheme());
  const paymentOptions = (price: string, description: string) => ({
    accepts: { scheme: 'exact' as const, price, network: config.network, payTo: config.payTo },
    description,
    mimeType: 'application/json',
  });
  const routes = [CLI_HOURLY_ROUTE, PREMIUM_WEEKLY_ROUTE, AGENT_SESSION_1HOUR_ROUTE, CODEX_AGENT_ROUTE];
  const app = new Hono<PaymentEnv>();
  app.use('*', async (c, next) => {
    await next();
    const purchase = c.get('purchase');
    if (purchase && c.res.status < 400) {
      const header = c.res.headers.get('payment-response');
      if (!header) return c.json({ error: 'Settlement receipt is missing' }, 502);
      const receipt = decodePaymentResponseHeader(header);
      if (!receipt.success || receipt.network !== config.network || !receipt.transaction) {
        return c.json({ error: 'Payment did not settle' }, 502);
      }
      const activated = await redeemSession(purchase.code, purchase.expiresAt, `${receipt.network}:${receipt.transaction}`);
      c.res = new Response(JSON.stringify(activated), { status: 200, headers: c.res.headers });
    }
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Expose-Headers', 'payment-required, payment-response');
  });
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST' && routes.includes(new URL(c.req.url).pathname)) {
      const body = await c.req.raw.clone().json().catch(() => null) as { code?: unknown } | null;
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      if (!code || !sessionExists(code)) return c.json({ error: 'Valid CLI pairing code is required' }, 400);
    }
    await next();
  });
  app.use(paymentMiddleware({
    [`POST ${CLI_HOURLY_ROUTE}`]: paymentOptions(CLI_HOURLY_PRICE_USDC, 'One hour of HelixBox agent session access.'),
    [`POST ${PREMIUM_WEEKLY_ROUTE}`]: paymentOptions(PREMIUM_WEEKLY_PRICE_USDC, 'Seven days of HelixBox agent session access.'),
    [`POST ${AGENT_SESSION_1HOUR_ROUTE}`]: paymentOptions(AGENT_SESSION_1HOUR_PRICE_USDC, 'One hour of HelixBox agent session access.'),
    [`POST ${CODEX_AGENT_ROUTE}`]: paymentOptions(AGENT_SESSION_1HOUR_PRICE_USDC, 'One hour of HelixBox agent session access.'),
  }, resourceServer));
  const redeem = (durationMs: number) => async (c: Context<PaymentEnv>) => {
    const body = await c.req.json<{ code: string }>();
    const purchase = { code: body.code.trim(), expiresAt: Date.now() + durationMs };
    c.set('purchase', purchase);
    return c.json(purchase);
  };
  app.post(CLI_HOURLY_ROUTE, redeem(60 * 60 * 1000));
  app.post(PREMIUM_WEEKLY_ROUTE, redeem(7 * 24 * 60 * 60 * 1000));
  app.post(AGENT_SESSION_1HOUR_ROUTE, redeem(60 * 60 * 1000));
  app.post(CODEX_AGENT_ROUTE, redeem(60 * 60 * 1000));
  return app;
}
