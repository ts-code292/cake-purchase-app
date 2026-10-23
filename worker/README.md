# Shared Product DB API

This Worker lets the static GitHub Pages app read a public product catalog and write changes to `products.json` without putting a GitHub token in browser code.

## Public data

The repository is public, so `products.json` and its product records are readable by anyone. Keep this catalog to barcode, product name, brand, pack size, unit, and category. Do not add prices, costs, stock counts, customer data, or other private information.

The app asks for a shared write code when staff connect. The Worker checks it and uses the GitHub token stored as a Cloudflare Worker secret. The write code is kept only in the current browser session. Use a long random code, and share it only with staff.

## Deploy the Worker

1. Create a fine-grained GitHub token limited to the `ts-code292/cake-purchase-app` repository with **Contents: Read and write** permission.
2. Create a Cloudflare account if needed. Install Node.js, then open a terminal in this `worker` directory.
3. Run `npx wrangler login`.
4. Set both secrets. Wrangler prompts for each value:
   - `npx wrangler secret put GITHUB_TOKEN`
   - `npx wrangler secret put TEAM_WRITE_CODE`
5. Deploy with `npx wrangler deploy`. Copy the resulting `https://...workers.dev` base URL (do not add `/products`).
6. Open the app on each device, enter the Worker URL and shared write code in Product DB, then choose **เชื่อม / โหลดฐานกลาง**.

The Worker writes to `products.json` on the `main` branch. The initial catalog file is empty. Existing device-local records are kept locally; after connecting, the app offers to merge missing local barcodes into the shared catalog. When both local and shared copies have the same barcode, the shared record is kept during that migration.

## API

- `GET /products`: read the shared catalog (public).
- `POST /products`: write an `upsert`, `delete`, `merge`, `mergeMissing`, or `replace` action. Requires `Authorization: Bearer <team-code>`.

Only requests from `https://ts-code292.github.io` are accepted by the Worker CORS policy. Update `APP_ORIGIN` if the GitHub Pages site uses another origin.
