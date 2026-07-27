/**
 * INVENTORY — Backend API
 * ------------------------------------------------------------
 * Node.js + Express + JWT auth + RBAC (admin / manager)
 * Data is persisted to a local JSON file (db.json) so nothing is
 * lost between restarts — no external database required.
 *
 * SETUP
 *   1) npm init -y
 *   2) npm install
 *   3) node server.js
 *   4) API runs at http://localhost:5000
 *
 * DEFAULT LOGINS (seeded on first run)
 *   Admin      username: admin     password: admin123
 *   Manager    username: manager   password: manager123
 *
 * EMPLOYEE SIGNUP BY EMAIL (optional but recommended for real use)
 *   Employees enter their email on the Sign Up screen → they receive
 *   an email with a link → they open it and set their own password →
 *   they can then log in. No account is created until the link is used.
 *   To actually send those emails, set these environment variables
 *   (e.g. in Render's "Environment" tab):
 *     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *       — any SMTP provider works (Gmail app password, SendGrid, Resend, etc.)
 *     FRONTEND_URL   — your live frontend URL, e.g. https://your-app.netlify.app
 *     ALLOWED_EMAIL_DOMAIN  — optional, e.g. "@yourcompany.com" to restrict
 *                              who is allowed to sign up
 *   Without SMTP configured, invite links are printed to the server
 *   console (and returned in the API response) so you can still test
 *   the whole flow before connecting real email.
 *
 * All monetary values are stored and returned in EUR.
 * ------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "inventory-dev-secret-change-me";
const DB_FILE = path.join(__dirname, "db.json");

// Where employees land after clicking the emailed invite link.
// Set this to your deployed frontend URL once it's live.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";

// If set, only emails ending in this domain can request a signup link
// (e.g. "@yourcompany.com"). Leave blank to allow any email address.
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "";

// Email transport — configure with real SMTP credentials to actually
// deliver invite emails. Without them, invite links are logged to the
// server console (and returned in the API response) so you can still
// test the flow locally before connecting a real mail provider.
const emailConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = emailConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendInviteEmail(toEmail, link) {
  if (!mailer) {
    console.log(`\n[INVITE EMAIL — not sent, SMTP not configured]\nTo: ${toEmail}\nLink: ${link}\n`);
    return false;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: "You're invited to Inventory",
    html: `<p>You've been invited to join <b>Inventory</b>.</p>
           <p><a href="${link}">Click here to set your password and activate your account</a></p>
           <p>This link expires in 48 hours. If you didn't expect this, you can ignore this email.</p>`,
  });
  return true;
}

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------
// Persistence layer (simple JSON file "database")
// ---------------------------------------------------------------
function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function seedDB() {
  const now = new Date().toISOString();

  const warehouses = [
    { id: "wh_a", name: "Warehouse A", location: "North Depot", capacity: 5000 },
    { id: "wh_b", name: "Warehouse B", location: "East Depot", capacity: 3000 },
    { id: "wh_c", name: "Warehouse C", location: "South Depot", capacity: 4000 },
  ];

  const suppliers = [
    { id: "sup_1", name: "NordTech Distribution", email: "sales@nordtech.example", phone: "+49 30 1234567", address: "Berlin, DE", outstandingBalance: 0 },
    { id: "sup_2", name: "Atlas Electronics Ltd", email: "orders@atlaselec.example", phone: "+33 1 4455667", address: "Paris, FR", outstandingBalance: 1250.5 },
    { id: "sup_3", name: "Meridian Supply Co", email: "info@meridiansupply.example", phone: "+34 91 2233445", address: "Madrid, ES", outstandingBalance: 0 },
  ];

  const users = [
    { id: "u_admin", username: "admin", name: "Admin User", role: "admin", passwordHash: bcrypt.hashSync("admin123", 8) },
    { id: "u_mgr", username: "manager", name: "Inventory Manager", role: "manager", passwordHash: bcrypt.hashSync("manager123", 8) },
  ];

  const dispatchers = [
    { id: "disp_1", name: "Marco Rossi", phone: "+39 06 5551234", email: "marco.rossi@dispatch.example", vehicle: "Van — AB123CD", notes: "" },
    { id: "disp_2", name: "Elena Popescu", phone: "+40 21 5559876", email: "elena.popescu@dispatch.example", vehicle: "Truck — XY456ZZ", notes: "" },
  ];

  const productSeeds = [
    { sku: "SKU-1001", barcode: "8901001", name: "UltraBook 14", brand: "Apple", category: "Laptop", unit: "pcs", purchasePrice: 950, sellingPrice: 1199, currentStock: 6, minStock: 3, warehouseId: "wh_a", billNumber: "2222", rating: 5, warranty: "12 months" },
    { sku: "SKU-1002", barcode: "8901002", name: "ProBook X5", brand: "Acer", category: "Laptop", unit: "pcs", purchasePrice: 700, sellingPrice: 899, currentStock: 3, minStock: 4, warehouseId: "wh_a", billNumber: "76786", rating: 4, warranty: "24 months" },
    { sku: "SKU-1003", barcode: "8901003", name: "SwiftBook 13", brand: "Lenovo", category: "Laptop", unit: "pcs", purchasePrice: 2600, sellingPrice: 3300, currentStock: 1, minStock: 2, warehouseId: "wh_b", billNumber: "45353", rating: 4, warranty: "12 months" },
    { sku: "SKU-2001", brand: "Logitech", barcode: "8902001", name: "Wireless Mouse M2", category: "Mouse", unit: "pcs", purchasePrice: 8, sellingPrice: 15, currentStock: 9, minStock: 5, warehouseId: "wh_a", billNumber: "10021", rating: 5, warranty: "6 months" },
    { sku: "SKU-2002", brand: "Dell", barcode: "8902002", name: "Optical Mouse D1", category: "Mouse", unit: "pcs", purchasePrice: 5, sellingPrice: 12, currentStock: 7, minStock: 6, warehouseId: "wh_c", billNumber: "10022", rating: 4, warranty: "6 months" },
    { sku: "SKU-3001", brand: "Samsung", barcode: "8903001", name: "Galaxy Fit Watch", category: "Watch", unit: "pcs", purchasePrice: 60, sellingPrice: 89, currentStock: 4, minStock: 4, warehouseId: "wh_b", billNumber: "334", rating: 5, warranty: "12 months" },
    { sku: "SKU-3002", brand: "Lenovo", barcode: "8903002", name: "Smart Watch Neo", category: "Watch", unit: "pcs", purchasePrice: 40, sellingPrice: 65, currentStock: 2, minStock: 3, warehouseId: "wh_b", billNumber: "122", rating: 5, warranty: "12 months" },
    { sku: "SKU-4001", brand: "Samsung", barcode: "8904001", name: "Galaxy Mobile S", category: "Mobile", unit: "pcs", purchasePrice: 520, sellingPrice: 699, currentStock: 4, minStock: 4, warehouseId: "wh_a", billNumber: "555", rating: 5, warranty: "24 months" },
    { sku: "SKU-5001", brand: "HP", barcode: "8905001", name: "NoiseCancel Headphone", category: "Headphone", unit: "pcs", purchasePrice: 45, sellingPrice: 79, currentStock: 7, minStock: 5, warehouseId: "wh_c", billNumber: "778", rating: 4, warranty: "12 months" },
    { sku: "SKU-5002", brand: "Apple", barcode: "8905002", name: "Studio Headphone Pro", category: "Headphone", unit: "pcs", purchasePrice: 150, sellingPrice: 229, currentStock: 0, minStock: 3, warehouseId: "wh_c", billNumber: "779", rating: 5, warranty: "24 months" },
  ];

  const products = productSeeds.map((p) => ({
    id: uid("prod"),
    ...p,
    supplierId: suppliers[Math.floor(Math.random() * suppliers.length)].id,
    status: p.currentStock === 0 ? "Out of Stock" : "Available",
    expiryDate: null,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    users,
    warehouses,
    suppliers,
    dispatchers,
    products,
    transactions: [],
    purchaseOrders: [],
    invites: [],
    activityLogs: [{ id: uid("log"), userId: "u_admin", action: "System seeded with demo data", createdAt: now }],
  };
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const fresh = seedDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!loaded.invites) loaded.invites = []; // migrate older db.json files
  if (!loaded.dispatchers) loaded.dispatchers = []; // migrate older db.json files
  return loaded;
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

function logActivity(userId, action) {
  db.activityLogs.unshift({ id: uid("log"), userId, action, createdAt: new Date().toISOString() });
  db.activityLogs = db.activityLogs.slice(0, 300);
}

// ---------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action" });
    }
    next();
  };
}

function recomputeStatus(product) {
  if (product.currentStock <= 0) product.status = "Out of Stock";
  else if (product.status === "Damaged" || product.status === "Return") {
    // keep manual statuses as-is
  } else {
    product.status = "Available";
  }
}

// ---------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "12h" });
  logActivity(user.id, `${user.name} logged in`);
  saveDB(db);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------
// SIGNUP / INVITE FLOW (public)
// An employee enters their email, gets a link by email, opens it,
// sets their own password, and can then log in. No open self-signup
// with an instant password — every account is confirmed by email.
// ---------------------------------------------------------------
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

app.post("/api/auth/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (ALLOWED_EMAIL_DOMAIN && !email.endsWith(ALLOWED_EMAIL_DOMAIN.toLowerCase())) {
    return res.status(403).json({ error: `Only ${ALLOWED_EMAIL_DOMAIN} email addresses can sign up` });
  }
  if (db.users.some((u) => u.username.toLowerCase() === email)) {
    return res.status(409).json({ error: "An account with this email already exists — try logging in instead" });
  }

  // Reuse an existing unused invite for this email instead of piling up duplicates
  db.invites = db.invites.filter((i) => !(i.email === email && !i.used));

  const invite = {
    id: uid("inv"),
    email,
    role: "manager", // self-signup accounts get standard operational access; an admin can promote later
    token: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    used: false,
    invitedBy: null,
  };
  db.invites.push(invite);
  saveDB(db);

  const link = `${FRONTEND_URL}?invite=${invite.token}`;
  const sent = await sendInviteEmail(email, link);
  logActivity("system", `Signup requested for ${email}`);
  saveDB(db);

  res.json({
    message: sent ? "Invite sent — check your email for the activation link." : "Invite created. Email sending isn't configured yet, so use the link below to test.",
    emailSent: sent,
    ...(sent ? {} : { devInviteLink: link }),
  });
});

app.get("/api/auth/invite/:token", (req, res) => {
  const invite = db.invites.find((i) => i.token === req.params.token);
  if (!invite) return res.status(404).json({ error: "This invite link is invalid" });
  if (invite.used) return res.status(410).json({ error: "This invite has already been used — please log in" });
  if (new Date(invite.expiresAt) < new Date()) return res.status(410).json({ error: "This invite link has expired — please request a new one" });
  res.json({ email: invite.email, role: invite.role });
});

app.post("/api/auth/accept-invite", (req, res) => {
  const { token, name, password } = req.body || {};
  const invite = db.invites.find((i) => i.token === token);
  if (!invite) return res.status(404).json({ error: "This invite link is invalid" });
  if (invite.used) return res.status(410).json({ error: "This invite has already been used — please log in" });
  if (new Date(invite.expiresAt) < new Date()) return res.status(410).json({ error: "This invite link has expired — please request a new one" });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const newUser = {
    id: uid("u"),
    username: invite.email,
    name: name || invite.email.split("@")[0],
    role: invite.role,
    passwordHash: bcrypt.hashSync(password, 8),
  };
  db.users.push(newUser);
  invite.used = true;
  logActivity(newUser.id, `${newUser.name} activated their account via invite`);
  saveDB(db);

  const authToken = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role, name: newUser.name }, JWT_SECRET, { expiresIn: "12h" });
  res.status(201).json({ token: authToken, user: { id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role } });
});

// Admin can directly invite someone (and choose their role) instead of
// waiting for a self-signup request.
app.post("/api/invites", authenticate, requireRole("admin"), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.role === "admin" ? "admin" : "manager";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (db.users.some((u) => u.username.toLowerCase() === email)) return res.status(409).json({ error: "That email already has an account" });

  db.invites = db.invites.filter((i) => !(i.email === email && !i.used));
  const invite = {
    id: uid("inv"), email, role,
    token: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    used: false, invitedBy: req.user.id,
  };
  db.invites.push(invite);
  const link = `${FRONTEND_URL}?invite=${invite.token}`;
  const sent = await sendInviteEmail(email, link);
  logActivity(req.user.id, `Invited ${email} as ${role}`);
  saveDB(db);
  res.status(201).json({ message: sent ? "Invite sent" : "Invite created (email not configured)", emailSent: sent, ...(sent ? {} : { devInviteLink: link }) });
});

app.get("/api/invites", authenticate, requireRole("admin"), (req, res) => {
  res.json(db.invites.map(({ token, ...safe }) => safe)); // never expose raw tokens in a list view
});

app.delete("/api/invites/:id", authenticate, requireRole("admin"), (req, res) => {
  db.invites = db.invites.filter((i) => i.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// USERS (admin only)
// ---------------------------------------------------------------
app.get("/api/users", authenticate, requireRole("admin"), (req, res) => {
  res.json(db.users.map(({ passwordHash, ...u }) => u));
});

app.post("/api/users", authenticate, requireRole("admin"), (req, res) => {
  const { username, name, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: "username, password, role are required" });
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: "Username already exists" });
  const newUser = { id: uid("u"), username, name: name || username, role, passwordHash: bcrypt.hashSync(password, 8) };
  db.users.push(newUser);
  logActivity(req.user.id, `Created user "${username}" (${role})`);
  saveDB(db);
  const { passwordHash, ...safe } = newUser;
  res.status(201).json(safe);
});

app.delete("/api/users/:id", authenticate, requireRole("admin"), (req, res) => {
  db.users = db.users.filter((u) => u.id !== req.params.id);
  logActivity(req.user.id, `Deleted user ${req.params.id}`);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------
app.get("/api/products", authenticate, (req, res) => {
  let items = [...db.products];
  const { brand, category, status, search, warehouseId } = req.query;
  if (brand) items = items.filter((p) => p.brand.toLowerCase() === String(brand).toLowerCase());
  if (category) items = items.filter((p) => p.category.toLowerCase() === String(category).toLowerCase());
  if (status) items = items.filter((p) => p.status.toLowerCase() === String(status).toLowerCase());
  if (warehouseId) items = items.filter((p) => p.warehouseId === warehouseId);
  if (search) {
    const s = String(search).toLowerCase();
    items = items.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode.includes(s));
  }
  res.json(items);
});

app.get("/api/products/:id", authenticate, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

app.post("/api/products", authenticate, requireRole("admin"), (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.category) return res.status(400).json({ error: "name and category are required" });
  const product = {
    id: uid("prod"),
    sku: body.sku || uid("SKU").toUpperCase(),
    barcode: body.barcode || String(Math.floor(Math.random() * 9000000) + 1000000),
    name: body.name,
    description: body.description || "",
    brand: body.brand || "Generic",
    category: body.category,
    supplierId: body.supplierId || null,
    unit: body.unit || "pcs",
    purchasePrice: Number(body.purchasePrice) || 0,
    sellingPrice: Number(body.sellingPrice) || 0,
    currentStock: Number(body.currentStock) || 0,
    minStock: Number(body.minStock) || 1,
    warehouseId: body.warehouseId || db.warehouses[0]?.id || null,
    billNumber: body.billNumber || "",
    rating: Number(body.rating) || 0,
    warranty: body.warranty || "",
    expiryDate: body.expiryDate || null,
    status: "Available",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  recomputeStatus(product);
  db.products.push(product);
  logActivity(req.user.id, `Added product "${product.name}"`);
  saveDB(db);
  res.status(201).json(product);
});

app.post("/api/products/bulk-import", authenticate, requireRole("admin"), (req, res) => {
  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  if (rows.length === 0) return res.status(400).json({ error: "No rows to import" });
  const created = [];
  const errors = [];
  rows.forEach((body, idx) => {
    if (!body.name || !body.category) {
      errors.push({ row: idx + 1, error: "name and category are required" });
      return;
    }
    const product = {
      id: uid("prod"),
      sku: body.sku || uid("SKU").toUpperCase(),
      barcode: body.barcode || String(Math.floor(Math.random() * 9000000) + 1000000),
      name: body.name,
      description: body.description || "",
      brand: body.brand || "Generic",
      category: body.category,
      supplierId: body.supplierId || null,
      unit: body.unit || "pcs",
      purchasePrice: Number(body.purchasePrice) || 0,
      sellingPrice: Number(body.sellingPrice) || 0,
      currentStock: Number(body.currentStock) || 0,
      minStock: Number(body.minStock) || 1,
      warehouseId: body.warehouseId || db.warehouses[0]?.id || null,
      billNumber: body.billNumber || "",
      rating: Number(body.rating) || 0,
      warranty: body.warranty || "",
      expiryDate: body.expiryDate || null,
      status: "Available",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    recomputeStatus(product);
    db.products.push(product);
    created.push(product);
  });
  if (created.length > 0) {
    logActivity(req.user.id, `Bulk imported ${created.length} product(s)`);
    saveDB(db);
  }
  res.status(201).json({ createdCount: created.length, errorCount: errors.length, errors, created });
});

app.post("/api/products/bulk-delete", authenticate, requireRole("admin"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: "No product ids provided" });
  const idSet = new Set(ids);
  const toDelete = db.products.filter((p) => idSet.has(p.id));
  db.products = db.products.filter((p) => !idSet.has(p.id));
  logActivity(req.user.id, `Bulk deleted ${toDelete.length} product(s)`);
  saveDB(db);
  res.json({ success: true, deletedCount: toDelete.length });
});

app.put("/api/products/:id", authenticate, requireRole("admin"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  Object.assign(product, req.body, { updatedAt: new Date().toISOString() });
  recomputeStatus(product);
  logActivity(req.user.id, `Updated product "${product.name}"`);
  saveDB(db);
  res.json(product);
});

app.delete("/api/products/:id", authenticate, requireRole("admin"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  db.products = db.products.filter((p) => p.id !== req.params.id);
  logActivity(req.user.id, `Deleted product "${product ? product.name : req.params.id}"`);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// INVENTORY ACTIONS (admin + manager)
// ---------------------------------------------------------------
function recordTransaction(type, product, payload, userId) {
  const user = db.users.find((u) => u.id === userId);
  const dispatcher = payload.dispatcherId ? db.dispatchers.find((d) => d.id === payload.dispatcherId) : null;
  const tx = {
    id: uid("tx"),
    type,
    productId: product.id,
    productName: product.name,
    quantity: Number(payload.quantity) || 0,
    fromWarehouseId: payload.fromWarehouseId || null,
    toWarehouseId: payload.toWarehouseId || null,
    note: payload.note || "",
    price: payload.price !== undefined ? Number(payload.price) || 0 : null,
    customerName: payload.customerName || "",
    dispatcherId: dispatcher ? dispatcher.id : null,
    dispatcherName: dispatcher ? dispatcher.name : "",
    userId,
    userName: user ? user.name : "Unknown",
    createdAt: new Date().toISOString(),
  };
  db.transactions.unshift(tx);
  return tx;
}

app.post("/api/inventory/:id/stock-in", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  product.currentStock += qty;
  recomputeStatus(product);
  const tx = recordTransaction("stock-in", product, req.body, req.user.id);
  logActivity(req.user.id, `Stock in: +${qty} for "${product.name}"`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.post("/api/inventory/:id/stock-out", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  if (qty > product.currentStock) return res.status(400).json({ error: "Not enough stock available" });
  product.currentStock -= qty;
  recomputeStatus(product);
  const tx = recordTransaction("stock-out", product, req.body, req.user.id);
  logActivity(req.user.id, `Stock out: -${qty} for "${product.name}"`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.post("/api/inventory/:id/transfer", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  if (qty > product.currentStock) return res.status(400).json({ error: "Not enough stock to transfer" });
  product.warehouseId = req.body.toWarehouseId || product.warehouseId;
  const tx = recordTransaction("transfer", product, req.body, req.user.id);
  logActivity(req.user.id, `Transferred ${qty} of "${product.name}"`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.post("/api/inventory/:id/damage", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  product.currentStock = Math.max(0, product.currentStock - qty);
  product.status = "Damaged";
  recomputeStatus(product);
  const tx = recordTransaction("damage", product, req.body, req.user.id);
  logActivity(req.user.id, `Reported ${qty} damaged for "${product.name}"`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.post("/api/inventory/:id/return", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  product.currentStock += qty;
  product.status = "Return";
  recomputeStatus(product);
  const tx = recordTransaction("return", product, req.body, req.user.id);
  logActivity(req.user.id, `Processed return of ${qty} for "${product.name}"`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.post("/api/inventory/:id/sale", authenticate, requireRole("admin", "manager"), (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const qty = Number(req.body.quantity) || 0;
  if (qty <= 0) return res.status(400).json({ error: "Quantity must be greater than 0" });
  if (qty > product.currentStock) return res.status(400).json({ error: "Not enough stock available" });
  product.currentStock -= qty;
  recomputeStatus(product);
  const price = req.body.price !== undefined && req.body.price !== "" ? Number(req.body.price) : product.sellingPrice;
  const tx = recordTransaction("sale", product, { ...req.body, price }, req.user.id);
  logActivity(req.user.id, `Sold ${qty} of "${product.name}"${req.body.customerName ? ` to ${req.body.customerName}` : ""}`);
  saveDB(db);
  res.json({ product, transaction: tx });
});

app.get("/api/transactions", authenticate, (req, res) => {
  let items = [...db.transactions];
  const { type, from, to, productId, userId, warehouseId } = req.query;
  if (type) items = items.filter((t) => t.type === type);
  if (productId) items = items.filter((t) => t.productId === productId);
  if (userId) items = items.filter((t) => t.userId === userId);
  if (warehouseId) items = items.filter((t) => t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId);
  if (from) items = items.filter((t) => new Date(t.createdAt) >= new Date(from));
  if (to) items = items.filter((t) => new Date(t.createdAt) <= new Date(`${to}T23:59:59.999Z`));
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  res.json(items.slice(0, limit));
});

// ---------------------------------------------------------------
// WAREHOUSES
// ---------------------------------------------------------------
app.get("/api/warehouses", authenticate, (req, res) => res.json(db.warehouses));

app.post("/api/warehouses", authenticate, requireRole("admin"), (req, res) => {
  const wh = { id: uid("wh"), name: req.body.name, location: req.body.location || "", capacity: Number(req.body.capacity) || 0 };
  db.warehouses.push(wh);
  logActivity(req.user.id, `Added warehouse "${wh.name}"`);
  saveDB(db);
  res.status(201).json(wh);
});

app.put("/api/warehouses/:id", authenticate, requireRole("admin"), (req, res) => {
  const wh = db.warehouses.find((w) => w.id === req.params.id);
  if (!wh) return res.status(404).json({ error: "Warehouse not found" });
  Object.assign(wh, req.body);
  saveDB(db);
  res.json(wh);
});

app.delete("/api/warehouses/:id", authenticate, requireRole("admin"), (req, res) => {
  db.warehouses = db.warehouses.filter((w) => w.id !== req.params.id);
  logActivity(req.user.id, `Deleted warehouse ${req.params.id}`);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// SUPPLIERS
// ---------------------------------------------------------------
app.get("/api/suppliers", authenticate, (req, res) => res.json(db.suppliers));

app.post("/api/suppliers", authenticate, requireRole("admin"), (req, res) => {
  const supplier = {
    id: uid("sup"),
    name: req.body.name,
    email: req.body.email || "",
    phone: req.body.phone || "",
    address: req.body.address || "",
    outstandingBalance: Number(req.body.outstandingBalance) || 0,
  };
  db.suppliers.push(supplier);
  logActivity(req.user.id, `Added supplier "${supplier.name}"`);
  saveDB(db);
  res.status(201).json(supplier);
});

app.put("/api/suppliers/:id", authenticate, requireRole("admin"), (req, res) => {
  const supplier = db.suppliers.find((s) => s.id === req.params.id);
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  Object.assign(supplier, req.body);
  saveDB(db);
  res.json(supplier);
});

app.delete("/api/suppliers/:id", authenticate, requireRole("admin"), (req, res) => {
  db.suppliers = db.suppliers.filter((s) => s.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// DISPATCHERS
// ---------------------------------------------------------------
app.get("/api/dispatchers", authenticate, (req, res) => res.json(db.dispatchers));

app.post("/api/dispatchers", authenticate, requireRole("admin"), (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: "Name is required" });
  const dispatcher = {
    id: uid("disp"),
    name: req.body.name,
    phone: req.body.phone || "",
    email: req.body.email || "",
    vehicle: req.body.vehicle || "",
    notes: req.body.notes || "",
  };
  db.dispatchers.push(dispatcher);
  logActivity(req.user.id, `Added dispatcher "${dispatcher.name}"`);
  saveDB(db);
  res.status(201).json(dispatcher);
});

app.put("/api/dispatchers/:id", authenticate, requireRole("admin"), (req, res) => {
  const dispatcher = db.dispatchers.find((d) => d.id === req.params.id);
  if (!dispatcher) return res.status(404).json({ error: "Dispatcher not found" });
  Object.assign(dispatcher, req.body);
  logActivity(req.user.id, `Updated dispatcher "${dispatcher.name}"`);
  saveDB(db);
  res.json(dispatcher);
});

app.delete("/api/dispatchers/:id", authenticate, requireRole("admin"), (req, res) => {
  const dispatcher = db.dispatchers.find((d) => d.id === req.params.id);
  db.dispatchers = db.dispatchers.filter((d) => d.id !== req.params.id);
  logActivity(req.user.id, `Deleted dispatcher "${dispatcher ? dispatcher.name : req.params.id}"`);
  saveDB(db);
  res.json({ success: true });
});

// ---------------------------------------------------------------
// PURCHASE ORDERS
// ---------------------------------------------------------------
app.get("/api/purchase-orders", authenticate, (req, res) => res.json(db.purchaseOrders));

app.post("/api/purchase-orders", authenticate, requireRole("admin"), (req, res) => {
  const po = {
    id: uid("po"),
    poNumber: `PO-${1000 + db.purchaseOrders.length + 1}`,
    supplierId: req.body.supplierId,
    items: req.body.items || [],
    status: "Pending",
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  db.purchaseOrders.push(po);
  logActivity(req.user.id, `Created purchase order ${po.poNumber}`);
  saveDB(db);
  res.status(201).json(po);
});

app.put("/api/purchase-orders/:id/approve", authenticate, requireRole("admin"), (req, res) => {
  const po = db.purchaseOrders.find((p) => p.id === req.params.id);
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  po.status = "Approved";
  logActivity(req.user.id, `Approved purchase order ${po.poNumber}`);
  saveDB(db);
  res.json(po);
});

app.put("/api/purchase-orders/:id/receive", authenticate, requireRole("admin", "manager"), (req, res) => {
  const po = db.purchaseOrders.find((p) => p.id === req.params.id);
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  po.status = "Received";
  (po.items || []).forEach((item) => {
    const product = db.products.find((p) => p.id === item.productId);
    if (product) {
      product.currentStock += Number(item.quantity) || 0;
      recomputeStatus(product);
      recordTransaction("stock-in", product, { quantity: item.quantity, note: `Received via ${po.poNumber}` }, req.user.id);
    }
  });
  logActivity(req.user.id, `Received purchase order ${po.poNumber}`);
  saveDB(db);
  res.json(po);
});

// ---------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------
app.get("/api/dashboard", authenticate, (req, res) => {
  const products = db.products;
  const totalInventory = products.reduce((sum, p) => sum + p.currentStock, 0);
  const inventoryValue = products.reduce((sum, p) => sum + p.currentStock * p.sellingPrice, 0);
  const totalDamaged = db.transactions.filter((t) => t.type === "damage").length;
  const totalReturned = db.transactions.filter((t) => t.type === "return").length;

  const byCategory = {};
  products.forEach((p) => {
    byCategory[p.category] = byCategory[p.category] || { category: p.category, count: 0, stock: 0 };
    byCategory[p.category].count += 1;
    byCategory[p.category].stock += p.currentStock;
  });

  const byStatus = {};
  products.forEach((p) => {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  });

  const topRequested = [...products]
    .sort((a, b) => b.currentStock - a.currentStock)
    .slice(0, 5)
    .map((p) => ({ name: p.name, category: p.category, stock: p.currentStock }));

  res.json({
    totalInventory,
    inventoryValueEUR: Number(inventoryValue.toFixed(2)),
    totalAvailableStores: db.warehouses.length,
    totalDamagedProduct: totalDamaged,
    totalReturnProduct: totalReturned,
    inventoryStatusSummary: Object.values(byCategory),
    inventoryByStatus: byStatus,
    topRequestedProducts: topRequested,
    lowStockCount: products.filter((p) => p.currentStock > 0 && p.currentStock <= p.minStock).length,
    outOfStockCount: products.filter((p) => p.currentStock === 0).length,
  });
});

// ---------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------
app.get("/api/notifications", authenticate, (req, res) => {
  const notifications = [];
  db.products.forEach((p) => {
    if (p.currentStock === 0) {
      notifications.push({ id: `n_out_${p.id}`, type: "out-of-stock", severity: "high", message: `"${p.name}" is out of stock` });
    } else if (p.currentStock <= p.minStock) {
      notifications.push({ id: `n_low_${p.id}`, type: "low-stock", severity: "medium", message: `"${p.name}" is low on stock (${p.currentStock} left)` });
    }
    if (p.expiryDate && new Date(p.expiryDate) < new Date(Date.now() + 14 * 24 * 3600 * 1000)) {
      notifications.push({ id: `n_exp_${p.id}`, type: "expiring", severity: "medium", message: `"${p.name}" expires soon (${p.expiryDate})` });
    }
  });
  db.purchaseOrders.filter((po) => po.status === "Pending").forEach((po) => {
    notifications.push({ id: `n_po_${po.id}`, type: "pending-approval", severity: "low", message: `Purchase order ${po.poNumber} is pending approval` });
  });
  res.json(notifications);
});

// ---------------------------------------------------------------
// ACTIVITY LOGS (admin)
// ---------------------------------------------------------------
app.get("/api/activity-logs", authenticate, requireRole("admin"), (req, res) => {
  res.json(db.activityLogs);
});

// ---------------------------------------------------------------
// REPORTS (CSV export)
// ---------------------------------------------------------------
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get("/api/reports/inventory.csv", authenticate, (req, res) => {
  const { warehouseId, category, from, to } = req.query;
  let items = [...db.products];
  if (warehouseId) items = items.filter((p) => p.warehouseId === warehouseId);
  if (category) items = items.filter((p) => p.category.toLowerCase() === String(category).toLowerCase());
  if (from) items = items.filter((p) => new Date(p.updatedAt || p.createdAt) >= new Date(from));
  if (to) items = items.filter((p) => new Date(p.updatedAt || p.createdAt) <= new Date(`${to}T23:59:59.999Z`));

  const header = "SKU,Name,Brand,Category,Warehouse,Stock,MinStock,PurchasePriceEUR,SellingPriceEUR,Status,LastUpdated\n";
  const rows = items
    .map((p) => {
      const wh = db.warehouses.find((w) => w.id === p.warehouseId);
      return [p.sku, p.name, p.brand, p.category, wh ? wh.name : "", p.currentStock, p.minStock, p.purchasePrice, p.sellingPrice, p.status, p.updatedAt]
        .map(csvCell)
        .join(",");
    })
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=inventory-report.csv");
  res.send(header + rows);
});

app.get("/api/reports/transactions.csv", authenticate, (req, res) => {
  const { from, to, type, warehouseId } = req.query;
  let items = [...db.transactions];
  if (type) items = items.filter((t) => t.type === type);
  if (warehouseId) items = items.filter((t) => t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId);
  if (from) items = items.filter((t) => new Date(t.createdAt) >= new Date(from));
  if (to) items = items.filter((t) => new Date(t.createdAt) <= new Date(`${to}T23:59:59.999Z`));

  const header = "Date,Type,Product,Quantity,PriceEUR,Customer,Dispatcher,User,Note\n";
  const rows = items
    .map((t) => [t.createdAt, t.type, t.productName, t.quantity, t.price ?? "", t.customerName || "", t.dispatcherName || "", t.userName || "", t.note || ""]
      .map(csvCell)
      .join(","))
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=transactions-report.csv");
  res.send(header + rows);
});

app.get("/api/reports/suppliers.csv", authenticate, (req, res) => {
  const header = "Name,Email,Phone,Address,OutstandingBalanceEUR\n";
  const rows = db.suppliers.map((s) => [s.name, s.email, s.phone, s.address, s.outstandingBalance].join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=suppliers-report.csv");
  res.send(header + rows);
});

// ---------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`\n  INVENTORY API running → http://localhost:${PORT}`);
  console.log(`  Login as  admin / admin123   or   manager / manager123\n`);
});
