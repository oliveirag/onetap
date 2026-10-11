// Registers the API's Stripe webhook endpoint (test mode) and prints its signing secret.
// Stripe shows the secret only when the endpoint is created, so an existing endpoint at the same
// URL is replaced. Usage: npm run setup:stripe -- https://<public-api-host>
// For local development use the Stripe CLI instead:
//   stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../apps/api/src/integrations/stripe/stripe.js';

const base = process.argv[2];
const key = process.env.STRIPE_SECRET_KEY;
if (!base?.startsWith('https://')) {
  console.error('Usage: npm run setup:stripe -- https://<public-api-host>');
  process.exit(1);
}
if (!key?.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY must be set to a test-mode key (sk_test_...).');
  process.exit(1);
}
const url = `${base.replace(/\/$/, '')}/api/v1/webhooks/stripe`;
const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
  if (endpoint.url === url) {
    console.log(`Replacing existing endpoint ${endpoint.id}`);
    await stripe.webhookEndpoints.del(endpoint.id);
  }
}

const endpoint = await stripe.webhookEndpoints.create({
  url,
  enabled_events: ['payment_intent.succeeded', 'payment_intent.payment_failed'],
  api_version: STRIPE_API_VERSION,
  description: 'OneTap API: Stripe test-mode charge status',
});
if (!endpoint.secret) throw new Error('Stripe returned no webhook secret');
console.log(`Webhook ${endpoint.id} -> ${url}`);
console.log(`Set STRIPE_WEBHOOK_SECRET=${endpoint.secret} in .env (and on the host), then restart the API.`);
