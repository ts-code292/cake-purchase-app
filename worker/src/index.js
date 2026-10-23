const API_PATH = "/products";
const MAX_BODY_BYTES = 256_000;
const MAX_PRODUCTS = 1_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.APP_ORIGIN || "https://ts-code292.github.io";
    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (origin && origin !== allowedOrigin) {
      return json({ error: "Origin is not allowed" }, 403, cors);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== API_PATH) return json({ error: "Not found" }, 404, cors);

    try {
      if (request.method === "GET") {
        const snapshot = await readCatalog(env);
        return json(snapshot.catalog, 200, { ...cors, "Cache-Control": "no-store" });
      }
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { ...cors, Allow: "GET, POST, OPTIONS" });
      }
      if (!env.GITHUB_TOKEN || !env.TEAM_WRITE_CODE) {
        return json({ error: "Worker secrets are not configured" }, 503, cors);
      }
      if (origin !== allowedOrigin) {
        return json({ error: "Origin is required for write requests" }, 403, cors);
      }
      const contentType = request.headers.get("Content-Type") || "";
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        return json({ error: "Content-Type must be application/json" }, 415, cors);
      }

      const suppliedCode = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!constantTimeEqual(suppliedCode, env.TEAM_WRITE_CODE)) {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.TEAM_AUTH_LIMITER.limit({ key: clientIp });
        if (!success) {
          return json({ error: "Too many invalid team codes. Try again in a minute." }, 429, {
            ...cors,
            "Retry-After": "60"
          });
        }
        return json({ error: "Invalid team write code" }, 401, cors);
      }

      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return json({ error: "Request is too large" }, 413, cors);
      }
      const bodyText = await readLimitedText(request, MAX_BODY_BYTES);
      if (bodyText === null) return json({ error: "Request is too large" }, 413, cors);
      let body;
      try { body = JSON.parse(bodyText); }
      catch { return json({ error: "Request body must be valid JSON" }, 400, cors); }

      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.TEAM_WRITE_LIMITER.limit({ key: clientIp });
      if (!success) {
        return json({ error: "Too many authorized requests. Try again in a minute." }, 429, {
          ...cors,
          "Retry-After": "60"
        });
      }

      if (body?.action === "verify") {
        const snapshot = await readCatalog(env);
        return json({ verified: true, ...snapshot.catalog }, 200, { ...cors, "Cache-Control": "no-store" });
      }

      const result = await mutateCatalog(env, body);
      return json(result, 200, { ...cors, "Cache-Control": "no-store" });
    } catch (error) {
      return json({ error: error?.message || "Unexpected server error" }, 500, cors);
    }
  }
};

function json(value, status, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length || left.length === 0) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function normalizeProduct(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Product must be an object");
  const barcode = typeof value.barcode === "string" ? value.barcode.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const brand = typeof value.brand === "string" ? value.brand.trim() : "";
  const packSize = typeof value.packSize === "string" ? value.packSize.trim() : String(value.packSize ?? "").trim();
  const unit = typeof value.unit === "string" ? value.unit.trim() : "";
  const category = typeof value.category === "string" ? value.category.trim() : "";
  if (!barcode) throw new Error("Product barcode is required as text");
  if (!name) throw new Error("Product name is required");
  if (!category) throw new Error("Product category is required");
  const fields = { barcode, name, brand, packSize, unit, category };
  const limits = { barcode: 64, name: 200, brand: 120, packSize: 80, unit: 40, category: 80 };
  for (const [field, maxLength] of Object.entries(limits)) {
    if (new TextEncoder().encode(fields[field]).byteLength > maxLength) {
      throw new Error("Product " + field + " exceeds the maximum length");
    }
  }
  return fields;
}

function normalizeList(value) {
  if (!Array.isArray(value)) throw new Error("products must be an array");
  if (value.length > MAX_PRODUCTS) throw new Error("Product DB cannot exceed " + MAX_PRODUCTS + " products");
  const list = value.map(normalizeProduct);
  const seen = new Set();
  for (const product of list) {
    if (seen.has(product.barcode)) throw new Error("Duplicate barcode in request: " + product.barcode);
    seen.add(product.barcode);
  }
  return list;
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function repoFileUrl(env) {
  const path = String(env.GITHUB_FILE_PATH || "products.json").split("/").map(encodeURIComponent).join("/");
  const owner = encodeURIComponent(env.GITHUB_OWNER || "ts-code292");
  const repo = encodeURIComponent(env.GITHUB_REPO || "cake-purchase-app");
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
}

function githubHeaders(env) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cake-purchase-product-db"
  };
}

async function readLimitedText(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readCatalog(env) {
  const response = await fetch(repoFileUrl(env), { headers: githubHeaders(env) });
  if (response.status === 404) return { sha: null, catalog: { schemaVersion: 1, products: [] } };
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Could not read products.json from GitHub");
  if (!result.content) throw new Error("GitHub returned an empty products.json file");
  let catalog;
  try { catalog = JSON.parse(decodeBase64Utf8(result.content)); }
  catch { throw new Error("products.json in GitHub is not valid UTF-8 JSON"); }
  const products = normalizeList(catalog.products);
  return {
    sha: result.sha,
    catalog: { schemaVersion: 1, updatedAt: catalog.updatedAt || null, products }
  };
}

async function mutateCatalog(env, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be an object");
  const action = body.action;
  if (!["upsert", "merge", "mergeMissing"].includes(action)) {
    throw new Error("Unsupported action");
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readCatalog(env);
    let products = [...snapshot.catalog.products];
    let conflicts = [];

    if (action === "upsert") {
      const product = normalizeProduct(body.product);
      products = products.filter(item => item.barcode !== product.barcode);
      products.push(product);
    } else {
      const incoming = normalizeList(body.products);
      const map = new Map(products.map(product => [product.barcode, product]));
      for (const product of incoming) {
        if (map.has(product.barcode)) {
          conflicts.push(product.barcode);
          if (action === "mergeMissing") continue;
        }
        map.set(product.barcode, product);
      }
      products = [...map.values()];
    }

    products = normalizeList(products);
    const catalog = { schemaVersion: 1, updatedAt: new Date().toISOString(), products };
    const content = encodeBase64Utf8(JSON.stringify(catalog, null, 2) + "\n");
    const putBody = {
      message: "Update shared Product DB (" + action + ")",
      content,
      branch: env.GITHUB_BRANCH || "main",
      ...(snapshot.sha ? { sha: snapshot.sha } : {})
    };
    const response = await fetch(repoFileUrl(env), {
      method: "PUT",
      headers: { ...githubHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify(putBody)
    });
    if (response.ok) return { ...catalog, conflicts };
    const error = await response.json().catch(() => ({}));
    if ((response.status === 409 || response.status === 422) && attempt < 2) continue;
    throw new Error(error.message || "Could not save products.json to GitHub (HTTP " + response.status + ")");
  }
  throw new Error("Product DB changed concurrently; please retry");
}
