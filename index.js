const express = require("express");
const cors    = require("cors");
const fetch   = (...a) => import("node-fetch").then(({default:f}) => f(...a));

const app  = express();
const PORT = process.env.PORT || 3000;

const ODOO_URL    = process.env.ODOO_URL;
const ODOO_DB     = process.env.ODOO_DB;
const READ_USER   = process.env.ODOO_READ_USER;
const READ_KEY    = process.env.ODOO_READ_KEY;
const WRITE_USER  = process.env.ODOO_WRITE_USER;
const WRITE_KEY   = process.env.ODOO_WRITE_KEY;
const PROXY_TOKEN = process.env.PROXY_TOKEN;

app.use(cors());
app.use(express.json());

// ── Token auth middleware ────────────────────────────────────────────────────
function requireToken(req, res, next) {
  const token = req.headers["x-proxy-token"];
  if (!PROXY_TOKEN) return res.status(500).json({ error: "PROXY_TOKEN not set on server." });
  if (!token || token !== PROXY_TOKEN) return res.status(403).json({ error: "Forbidden." });
  next();
}

// ── Odoo XML-RPC style JSON-RPC auth (correct method for API keys) ───────────
async function getUid(user, apiKey) {
  const r = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call", id: 1,
      params: {
        model: "res.users",
        method: "search_read",
        args: [[["login", "=", user]]],
        kwargs: {
          fields: ["id", "login"],
          limit: 1,
          context: {},
        }
      }
    })
  });
  const d = await r.json();
  if (d.result?.length > 0) return d.result[0].id;
  throw new Error("User not found: " + user);
}

// ── Odoo call using API key as password via session authenticate ─────────────
async function odooCallWithKey(model, method, args, kwargs, user, apiKey) {
  // Step 1: authenticate to get session cookie
  const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call", id: 1,
      params: { db: ODOO_DB, login: user, password: apiKey }
    })
  });
  const authData = await authRes.json();
  if (!authData.result?.uid) {
    throw new Error("Auth failed: " + JSON.stringify(authData.error?.data?.message || authData));
  }
  // Extract session cookie
  const cookies = authRes.headers.get("set-cookie") || "";

  // Step 2: use session cookie to call Odoo
  const r = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookies
    },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call", id: 2,
      params: { model, method, args, kwargs }
    })
  });
  return r.json();
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "H2O Odoo Proxy running" }));

// ── Test connection ──────────────────────────────────────────────────────────
app.get("/test", requireToken, async (req, res) => {
  try {
    const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "call", id: 1,
        params: { db: ODOO_DB, login: READ_USER, password: READ_KEY }
      })
    });
    const d = await authRes.json();
    if (d.result?.uid) {
      res.json({ ok: true, uid: d.result.uid, db: ODOO_DB, user: d.result.name });
    } else {
      res.status(401).json({ ok: false, error: d.error?.data?.message || JSON.stringify(d.result) });
    }
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Search products (read) ────────────────────────────────────────────────────
app.post("/search", requireToken, async (req, res) => {
  try {
    const { domain, fields, limit } = req.body;
    const result = await odooCallWithKey(
      "product.template", "search_read",
      [domain], { fields, limit: limit || 20 },
      READ_USER, READ_KEY
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Create product (write) ────────────────────────────────────────────────────
app.post("/create", requireToken, async (req, res) => {
  try {
    const { vals } = req.body;
    const result = await odooCallWithKey(
      "product.template", "create",
      [vals], {},
      WRITE_USER, WRITE_KEY
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`H2O Odoo Proxy running on port ${PORT}`));
