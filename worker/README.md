# Shared Product DB API

This Worker lets the static GitHub Pages app read a public product catalog and write changes to `products.json` without putting a GitHub token in browser code.

## Public data

The repository is public, so `products.json` and its product records are readable by anyone. Keep this catalog to barcode, product name, brand, pack size, unit, and category. Do not add prices, costs, stock counts, customer data, or other private information.

The app requires the shared team code at its entry screen. The Worker checks it before the app opens and uses the same code for Product DB writes. The code is kept only in the current browser session. Use a randomly generated code with at least 16 characters, share it only with staff, and rotate it in Cloudflare if exposed. The Worker rate-limits failed code attempts per IP. This app gate does not make the public GitHub catalog private.

## ค่าใช้จ่ายและโควตาฟรี

ใช้ Cloudflare Workers Free และ URL `workers.dev` ที่ Wrangler จัดให้ ไม่ต้องซื้อ Workers Paid, custom domain, KV หรือฐานข้อมูล Cloudflare อื่น ๆ โควตาฟรีมี 100,000 คำขอต่อวัน; เมื่อเกินจะถูกปฏิเสธจนกว่าจะรีเซ็ต ไม่ได้คิดค่าเกินโควตาบนแผน Free ตาม [ราคาและข้อจำกัด Workers](https://developers.cloudflare.com/workers/platform/pricing/)

ให้ตรวจหน้า Plan/Billing ก่อนยืนยันการตั้งค่า และอย่าเลือกหรืออัปเกรดเป็น Workers Paid (แผน Paid เริ่มคิดค่าบริการรายเดือน) หากหน้าจอขอเปิดแผนเสียเงิน ให้หยุดไว้ก่อน

## Deploy the Worker

1. Create a fine-grained GitHub token limited to the `ts-code292/cake-purchase-app` repository with **Contents: Read and write** permission.
2. Create a Cloudflare account if needed. Install Node.js, then open a terminal in this `worker` directory.
3. Run `npx wrangler login`.
4. Set both secrets. Wrangler prompts for each value:
   - `npx wrangler secret put GITHUB_TOKEN`
   - `npx wrangler secret put TEAM_WRITE_CODE`
5. Deploy with `npx wrangler deploy`. Copy the resulting `https://...workers.dev` base URL (do not add `/products`).
6. Open the app on each device. Enter the shared team code at the entry screen; the app verifies it with the Worker before opening. Then use **สแกน / จัดการสินค้า** or **บันทึกรอบซื้อ**.

The Worker writes to `products.json` on the `main` branch. The initial catalog file is empty. The API caps the database at 1,000 products, limits field sizes, and only supports upsert/merge operations so a normal API request cannot replace or delete the full catalog. Existing device-local records are kept locally; after connecting, the app offers to merge missing local barcodes into the shared catalog. When both local and shared copies have the same barcode, the shared record is kept during that migration.

## API

- `GET /products`: read the shared catalog (public).
- `POST /products` with `action: verify`: validate the team code without changing the catalog and return the public catalog.
- `POST /products`: write an `upsert`, `merge`, or `mergeMissing` action. Requires `Authorization: Bearer <team-code>`, JSON content type, and the configured app Origin. Invalid codes are rate-limited.

Only requests from `https://ts-code292.github.io` are accepted by the Worker CORS policy. Update `APP_ORIGIN` if the GitHub Pages site uses another origin.
