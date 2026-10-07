# CoinDealer merchant portal

Responsive Vue 3 + Vite frontend for the coin-merchant portal. The root URL
opens the merchant login page; this build is not the standalone end-user
third-party checkout.

## Routes

- `/#/` — canonical coin-merchant login page.
- `/#/merchant/login` — compatibility login URL.
- `/#/merchant/recharge` — protected merchant portal. Unauthenticated users are
  returned to `/` with a redirect query.

The portal stores the short-lived merchant token in browser `localStorage` and
never fabricates balances, credits, order status, or transfer results. It uses
hash routing so browser refreshes request only `/` from the static server; the
application route after `#` remains entirely in the browser.

## Coin-merchant API contract

The implementation follows the dedicated Apifox contracts (latest refresh:
2026-09-17):

- `POST /auth/coinMerchantLogin`: `{ "username", "password" }`, where the
  password is sent as a lowercase MD5 hex digest, returning `{ "token" }`.
- `POST /coinMerchantRechargeCfg/coinMerchantRechargeCfgListForApp`: `{}` with
  the merchant `Authorization` token, returning
  `{ "list": [{ "id", "name", "price", "gold" }] }`.
- `POST /coinMerchantRechargeCfg/paymentRegionList`: `{}` with the merchant
  `Authorization` token, returning the HaiPay regions enabled for that coin
  merchant. The selected `currencyCode` is sent unchanged when creating an
  order.
- `POST /rechargeOrder/createCoinMerchantChannelRechargeOrder`: `{ "cfgId",
  "currencyCode" }`, where `currencyCode` is the selected HaiPay region code,
  returning an `orderId` and YHPAY `payUrl`.
- WebSocket `cmd=40`: the authenticated merchant connection receives
  `{ "orderId", "price", "gold", "goldBalance", "payChannel" }` after a
  recharge succeeds. Only a notification matching the current `orderId` is
  accepted.
- `POST /rechargeOrder/checkRechargeOrderSuccess`: `{ "orderId" }`, used once
  after order creation and again when the page returns to the foreground,
  regains connectivity, or the merchant manually refreshes the status.
- `POST /rechargeOrder/myRechargeOrderList`: status `3` (expired/cancelled) and
  `4` (failed) are queried when the success check is false. Apifox does not
  define a recharge-failure WebSocket message.
- `POST /gold/transferGold`: `{ "targetUserId", "amount" }`; amount is at
  least `0.01` with at most two decimal places.
- `POST /userInfo/get`: `{}` to refresh the authenticated merchant's `gold`
  balance and `userId`.
- `POST /gold/getCoinMerchantTransferRecordList`: `{ "pageIndex", "pageSize" }`
  to page through transfers sent by the authenticated merchant. The contract
  also supports optional `targetUserId`, `startTime`, and `endTime` filters.

Apifox declares `Authorization` as an `apiKey` header, so the client sends the
stored token as-is without adding a `Bearer ` prefix. The same token is sent as
the WebSocket `Authorization` query parameter. A dropped or unavailable socket
is never treated as a failed payment; the documented HTTP status endpoints are
the fallback and terminal-failure authority.

Override `VITE_MERCHANT_LOGIN_PATH`, `VITE_MERCHANT_CONFIG_PATH`,
`VITE_MERCHANT_PAYMENT_REGION_PATH`, `VITE_MERCHANT_RECHARGE_PATH`,
`VITE_MERCHANT_ORDER_STATUS_PATH`,
`VITE_MERCHANT_ORDER_LIST_PATH`, `VITE_MERCHANT_TRANSFER_PATH`,
`VITE_MERCHANT_BALANCE_PATH`, or `VITE_MERCHANT_TRANSFER_RECORD_PATH` only when an
API gateway rewrites these paths.
Set `VITE_WEBSOCKET_URL` to the authenticated push endpoint for each build
environment.

Payload encryption is disabled in the current test and production builds:
merchant requests send plain JSON with `X-Coin-Merchant-Client: 0`. The code
retains the same AES-256-GCM feature switch as VueH5. When
`VITE_MERCHANT_API_ENCRYPTION` is set to `true`, requests and responses use
`Base64(nonce + ciphertext + tag)`, where the nonce is 12 random bytes, the
authentication tag is 128 bits, the key is
`SHA-256(UTF8(VITE_MERCHANT_API_KEY))`, and the request header value changes to
`1`.

## Build and deployment

Build the test and production environments separately. Do not reuse the
`dist` output from a different environment:

```bash
npm run build:test
npm run build:prod
```

Use the following settings for the coin-merchant H5 deployment in the
deployment console:

| Environment | Site domain | Server directory |
| --- | --- | --- |
| Test | `https://coin-merchant.bigtktool.shop` | `/home/ec2-user/cdn/coin-merchant` |
| Production | `https://coin-merchant.saralive.net` | `/home/ec2-user/cdn/coin-merchant` |

The test and production API and WebSocket origins are injected through
`.env.test` and `.env.production`, respectively:

| Build mode | API origin | WebSocket endpoint |
| --- | --- | --- |
| `test` | `https://www.bigtktool.shop` | `wss://www.bigtktool.shop/ws` |
| `production` | `https://www.saralive.net` | `wss://saralive.net/ws` |

Package the `dist` contents for the target environment and upload them through
the coin-merchant H5 deployment entry in the deployment console. Do not use
the third-party payment deployment entry. The production domain will show this
project only after the production package is uploaded.

## Hash routing and optional Nginx compatibility

Hash routes do not require an SPA fallback. The static server only needs to
serve `index.html` at `/` and the generated files under `/assets/`. For example,
refreshing `/#/merchant/recharge` sends a request for `/`, not
`/merchant/recharge`.

The rules in [`deploy/nginx.third-pay.conf`](deploy/nginx.third-pay.conf) may be
kept for compatibility with old clean URLs. They are not required for normal
hash-route refreshes. Verify the required root entry point with:

```bash
curl -I https://coin-merchant.bigtktool.shop/
```

The request must return `200`. Old clean URLs such as `/merchant/recharge` may
still return `404`; use `/#/merchant/recharge` after deploying this build.

## Local development

```bash
npm install
copy .env.example .env
npm test
npm run dev
```
