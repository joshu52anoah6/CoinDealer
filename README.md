# Payment Site

Responsive Vue 3 + Vite frontend for the standalone recharge site.

## Merchant sign-in and recharge

The merchant entry point is `/merchant/login`. After sign-in, the short-lived
token is stored in browser `localStorage`, and a router guard protects
`/merchant/recharge`. The merchant page accepts a target user ID, creates an
order through the protected recharge API, and receives `pending`, `success`,
or `failed` updates over WebSocket. The frontend never fabricates a credit.

The default contract is:

- `POST /merchant/login`: `{ "account", "username", "password" }`, returning
  `token`/`accessToken` and a merchant role (`merchant`, `coin_merchant`, or
  `ROLE_MERCHANT`).
- `POST /rechargeCfg/rechargeCfgListByUserId`: sends `Authorization: Bearer
  <token>` and `{ "userId" }`, returning packages available for the target user.
- `POST /rechargeOrder/createRechargeOrder`: sends the same token and
  `{ "userId", "cfgId", "currencyCode" }`, returning `orderId`.
- `ws(s)://<api-origin>/ws/merchant`: after connecting, the client sends
  `{ "type": "authenticate", "token" }`, then
  `{ "type": "subscribe", "orderId" }`. Server messages include the order ID
  and a status.

Configure `VITE_MERCHANT_LOGIN_PATH`, `VITE_MERCHANT_CONFIG_PATH`,
`VITE_MERCHANT_RECHARGE_PATH`, `VITE_MERCHANT_WS_URL`, or
`VITE_MERCHANT_WS_PATH` when the Apifox project exposes different paths. A
browser WebSocket cannot set a custom HTTP header, so the token is sent in a
JSON authentication frame. If Apifox uses different frame names, update the
central adapter in `src/api/merchantSocket.ts`.

## Apifox endpoints wired

- `POST /rechargeCfg/rechargeCfgListByUserId` with `{ "userId" }` (the
  unauthenticated, user-scoped configuration endpoint).
- `POST /fiatCurrency/fiatCurrencyListForApp` with `{ "typeFilter": 0 }` to
  load all currency display metadata.
- `POST /rechargeOrder/createChannelRechargeOrder` with
  `{ "userId", "cfgId", "currencyCode" }` (the unauthenticated channel
  endpoint; Apifox currently documents IDR as the supported channel currency).
- `POST /rechargeOrder/checkRechargeOrderSuccess` with `{ "orderId" }`.

The authenticated App flow (`/rechargeCfg/rechargeCfgListForApp` and
`/rechargeOrder/createRechargeOrder`) is intentionally not used by this site.

Note: the status endpoint accepts only `orderId` in the Apifox request body,
but the test environment still returns `Invalid or expired token`. To keep
unauthenticated status polling on the standalone page, the backend must allow
this endpoint without authentication or expose a dedicated channel status
endpoint. There is currently no replacement Apifox path.

The channel order response includes `orderId` and `payUrl`. After the user
clicks the payment button, the frontend opens a top-level window, immediately
sets its `opener` to `null`, and sends that window to the returned HTTPS URL;
it does not embed the provider page in an iframe. If the browser blocks the
popup, the page falls back to top-level navigation. The result page polls the
order status with `orderId`.

Recharge success, wallet-ledger crediting, and H5 gold/diamond balance updates
remain authoritative on backend webhooks, order queries, and existing pushes.
The payment frontend never fakes success or writes balances directly.

The frontend directly calls the existing business APIs. The host application
provides the logged-in user's ID in the checkout URL:

```text
https://pay.example.com/?userId=123456
```

The root URL is the only checkout entry point. The compatibility query aliases
for the user ID are `user_id`, `uid`, and `id`.

## Balance-deficit recommendation contract

VueH5 can navigate from a balance-deficit dialog to the root path with these
recommendation parameters:

```text
/?userId=user-42&rechargeCurrency=diamond&requiredAmount=120
```

- `userId`: the current user ID. It only scopes the existing user package and
  channel-order APIs. The backend must validate identity, order ownership, and
  crediting; a URL value is never an authority.
- `rechargeCurrency`: an optional wallet recommendation, strictly `diamond` or
  `gold`.
- `requiredAmount`: an optional deficit matching `/^\d+$/`, up to 30 decimal
  digits. Empty, decimal, negative, repeated, or oversized values disable the
  recommendation.

Both recommendation parameters must be valid. After packages load, the page
uses explicit backend fields such as `actualCreditedDiamonds`,
`actualCreditedGold`, `creditedDiamonds`, `creditedGold`, and currency-labelled
`creditedAmount`/`creditedAmounts` to select the smallest package where
`creditedAmount >= requiredAmount`. These values only affect the default choice
and hint; they are never sent to `createChannelRechargeOrder` and cannot define
the charge, identity, or credit.

If the backend returns only gold/coin packages, a diamond recommendation is
calculated only when explicit credited diamonds or a backend conversion relation
such as `goldToDiamondRate` or `{ from: "gold", to: "diamond" }` is present. The
payment frontend never hardcodes a gold-to-diamond ratio. `firstRechargeRatio`
is not used to derive a bonus in the browser. Explicit credited/actual fields
are final; only explicit `bonusGold`, `extraGold`, or `bonusDiamonds` fields add
a separate bonus.

If no package covers the deficit, the page keeps its default selection and asks
the user to choose a larger package. The user can always change the selection.

Wallet recommendation currency and payment-channel fiat currency are separate.
The existing `fiatCurrency` IDR/MYR (and any other available channel currency)
selector and order request remain unchanged.

`app` and `lang` are optional display parameters and do not need to be
supplied by Sora/VueH5. When omitted, the brand falls back to `Recharge` and
the page uses its default language. No other configuration parameter is needed
in the checkout URL.

This URL-level rule is separate from the backend request bodies: after the user
chooses a package, the frontend sends the supplied `userId`, selected `cfgId`,
and the selected currency's `currencyCode` to `createChannelRechargeOrder`, as
required by the current backend contract.

## Deployment

The two environments use the same static build and the same server directory:

| Environment | Site domain | Server directory |
| --- | --- | --- |
| Test | `https://third-pay.bigtktool.shop` | `/home/ec2-user/cdn/third-pay` |
| Production | `https://third-pay.saralive.net` | `/home/ec2-user/cdn/third-pay` |

The API origin follows the VueH5/Sora environment configuration:

| Build mode | API origin |
| --- | --- |
| `test` | `https://www.bigtktool.shop` |
| `production` | `https://www.saralive.net` |

These values are stored in `.env.test` and `.env.production`. The API must allow the payment site origins in CORS.

## Open the payment site from Sora/VueH5

Use the corresponding payment-site domain:

```text
# Test
https://third-pay.bigtktool.shop/?userId=123456

# Production
https://third-pay.saralive.net/?userId=123456
```

`userId` is required and must be the logged-in Sora/VueH5 user's ID. `user_id`,
`uid`, and `id` are accepted as compatibility aliases. `app` and `lang` are
optional display parameters. The page then loads the user-scoped recharge list
and first-recharge fields from the user-scoped response, creates a channel
order with `userId` after the user selects a package, redirects to the returned
`payUrl`, and polls the order result page.

Example from VueH5/Sora (only `userId` is required; the two recommendation
parameters are optional):

```ts
const paymentUrl = new URL('https://third-pay.bigtktool.shop/')
paymentUrl.searchParams.set('userId', String(currentUser.id))
// Optional balance-deficit hint; it is never used as an order authority.
paymentUrl.searchParams.set('rechargeCurrency', 'diamond')
paymentUrl.searchParams.set('requiredAmount', '120')
window.location.assign(paymentUrl.toString())
```

The payment page keeps the supplied ID in memory and sends it as `userId` when
loading the user-scoped recharge list and creating the channel recharge order.
The backend must validate that ID and persist it on the order; do not use a
phone number or other sensitive identifier. The third-party payment URL should
be generated by the backend with the order/user association intact rather than
modified in the browser. It should be HTTPS, short-lived, single-use where
supported, and contain only the provider's order token (never a raw `userId`,
access token, or other reusable credential). The frontend rejects non-HTTPS or
malformed URLs.

The root checkout link (`/?userId=123456`) normally avoids deep-link issues.
The web server still needs the SPA fallback for `/payment-result` and any other
history-mode route. Install the Nginx block in
`deploy/nginx.third-pay.conf` (or configure the equivalent rewrite) so unknown
application paths serve `/index.html`.

Build commands:

```bash
npm run build:test
npm run build:prod
```

Upload the generated `dist` contents to `/home/ec2-user/cdn/third-pay`. For clean Vue Router URLs, the web server should fall back unknown paths to `index.html`.

The ready-to-use Nginx server block is in `deploy/nginx.third-pay.conf`. After installing it, validate and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The active TLS (`listen 443 ssl`) server block must contain the same
`location ^~ /merchant/` and `location /` `try_files` rules. The file in this
repository listens on port 80; if HTTPS is terminated in a separate Nginx
block, copy these two locations into that block as well. Verify the fallback
before testing the login API:

```bash
curl -I https://third-pay.bigtktool.shop/index.html
curl -I https://third-pay.bigtktool.shop/merchant/login
```

Both requests should return `200`, with the second request serving the same
`index.html` document as the first.

## Run

```bash
npm install
copy .env.example .env
npm test
npm run dev
```
