const express = require("express");
const cors    = require("cors");
const fetch   = (...a) => import("node-fetch").then(({default:f}) => f(...a));

const app  = express();
const PORT = process.env.PORT || 3000;

const ODOO_URL     = process.env.ODOO_URL;
const ODOO_DB      = process.env.ODOO_DB;
const READ_USER    = process.env.ODOO_READ_USER;
const READ_KEY     = process.env.ODOO_READ_KEY;
const WRITE_USER   = process.env.ODOO_WRITE_USER;
const WRITE_KEY    = process.env.ODOO_WRITE_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://claude.ai";

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Health check
app.get("/", (req, res) => res.json({ status: "H2O Odoo Proxy running" }));

// Authenticate with Odoo
async function authenticate(user, key) {
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call", id: 1,
      params: { db: ODOO_DB, login: user, password: key }
    })
  });
  const d = await r.json();
  if (!d.result?.uid) throw new Error("Odoo auth failed: " + JSON.stringify(d.error || d.result));
  return d.result.uid;
}

// Generic Odoo call
async function odooCall(model, method, args, kwargs, user, key) {
  await authenticate(user, key);
  const r = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call", id: 2,
      params: { model, method, args, kwargs }
    })
  });
  return r.json();
}

// Test connection
app.get("/test", async (req, res) => {
  try {
    const uid = await authenticate(READ_USER, READ_KEY);
    res.json({ ok: true, uid, db: ODOO_DB });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Search products (read - duplicate check)
app.post("/search", async (req, res) => {
  try {
    const { domain, fields, limit } = req.body;
    const result = await odooCall(
      "product.template", "search_read",
      [domain], { fields, limit: limit || 20 },
      READ_USER, READ_KEY
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Create product (write)
app.post("/create", async (req, res) => {
  try {
    const { vals } = req.body;
    const result = await odooCall(
      "product.template", "create",
      [vals], {},
      WRITE_USER, WRITE_KEY
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
