# FamUpiGateway Starter

A mobile-responsive merchant portal and API starter based on the provided visual references. This is an independent project, not affiliated with FamPay or any similarly named business.

## Included
- Public landing page and responsive merchant workspace
- Merchant signup/login (bcrypt password hashing, short-lived JWT)
- API key generation (only SHA-256 hash stored; raw key shown once)
- Merchant-scoped create-order and order-status endpoints
- PostgreSQL schema and transaction dashboard
- Razorpay order creation adapter and signed webhook verification
- Basic request rate limiting, Helmet security headers, schema validation

## Important production boundary
This starter is **not a licensed payment aggregator** and is not ready to process live payments merely by deploying it. Real UPI collection requires an approved payment provider/bank arrangement, completed KYC/business onboarding, production credentials, and provider-specific checkout and reconciliation. The backend creates a provider order but a production checkout UI and end-to-end verification flow must be integrated and tested before going live. Do not claim instant settlement or collect Gmail/app passwords. Never store card PINs, UPI PINs, OTPs, or payment passwords.

## Requirements
- Node.js 20+
- PostgreSQL 14+
- An approved Razorpay account and API credentials for provider testing/production

## Run locally
1. Copy `.env.example` to `.env` and set `DATABASE_URL` and a strong random `JWT_SECRET` (32+ characters).
2. Create a PostgreSQL database named `famupigateway`. Ensure PostgreSQL supports `gen_random_uuid()` (PostgreSQL 13+ commonly includes pgcrypto; if needed run `CREATE EXTENSION IF NOT EXISTS pgcrypto;`).
3. Install dependencies: `npm install`
4. Initialize schema: `npm run db:init`
5. Start: `npm run dev`
6. Open `http://localhost:3000` and click Merchant Login.

## Environment variables
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN` (comma-separated exact origins)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `APP_BASE_URL`, `PORT`

## API
### Signup
`POST /api/auth/signup`
```json
{"name":"Example Store","email":"owner@example.com","password":"use-a-long-password"}
```

### Create a key
Authenticated merchant: `POST /api/keys`
```json
{"label":"Production server"}
```
The raw key is returned once. Keep it in the merchant backend's secret manager.

### Create an order
`POST /api/v1/orders`
Headers: `X-API-Key: fup_live_...`
```json
{"amount":100,"order_id":"ORDER-123","customer_name":"Test Customer"}
```
Amount is INR. Provider order is created in paise. The response includes provider order identifiers and public key ID for checkout integration.

### Check status
`GET /api/v1/orders/ORDER-123`
Header: `X-API-Key: fup_live_...`

### Webhook
Configure the provider webhook URL as `https://YOUR_DOMAIN/webhooks/razorpay`, with `payment.captured` and `payment.failed` events, and copy its webhook secret to `RAZORPAY_WEBHOOK_SECRET`.

## Before domain launch
- Deploy behind HTTPS; configure DNS and TLS.
- Use managed PostgreSQL with encrypted backups.
- Set production secrets via host secret manager, not a committed `.env`.
- Configure provider webhook and test signatures/retries/idempotency.
- Add email verification, password reset, CSRF protection if switching to cookie sessions, audit logs, monitoring, admin RBAC, reconciliation and refund workflows.
- Have provider/business/legal compliance reviewed before accepting live payments.
