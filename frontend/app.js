const $ = id => document.getElementById(id);

let currentUserId = null;
let isAdmin = false;
let cart = [];
let topupInterval = null;
let menuStock = {};

function fmt(v) {
  return v + " Kč";
}

// -----------------------------------------------------
//  MODAL
// -----------------------------------------------------
function showModal(title, text) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <h3>${title}</h3>
    <p>${text}</p>
    <button class="btn btn-primary">OK</button>
  `;

  modal.querySelector("button").onclick = () => overlay.remove();
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// -----------------------------------------------------
//  SPOLEČNÁ FUNKCE PO LOGINU / REGISTRACI + AUTO LOGIN
// -----------------------------------------------------
function afterAuth(identifier, data) {
  currentUserId = data.userId;
  isAdmin = data.role === "admin" || data.role === "manager";

  localStorage.setItem("user", JSON.stringify({
    userId: data.userId,
    name: identifier,
    isAdmin,
    credit: data.credit
  }));

  $("loggedUser").textContent = "Uživatel: " + identifier;
  $("logoutBtn").classList.remove("hidden");

  $("login").classList.add("hidden");
  $("user").classList.remove("hidden");
  $("credit").textContent = fmt(data.credit);

  $("menu").classList.remove("hidden");
  $("order").classList.remove("hidden");
  renderCart();

  populateDates();
  loadMenu();

  if (isAdmin) {
    $("admin").classList.remove("hidden");

    $("adminDate").value = new Date().toISOString().slice(0, 10);
    $("statsDate").value = new Date().toISOString().slice(0, 10);

    $("adminDate").onchange = loadAdminMenu;
    $("statsDate").onchange = loadDailyStats;

    loadFoods();
    loadAdminMenu();
    loadAdminStats();
    loadDailyStats();
  }
}

// -----------------------------------------------------
//  AUTO LOGIN PO REFRESHI
// -----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("user");
  if (!saved) return;

  const u = JSON.parse(saved);

  afterAuth(u.name, {
    userId: u.userId,
    role: u.isAdmin ? "admin" : "user",
    credit: u.credit
  });
});

// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
async function login() {
  const ident = $("loginInput").value.trim();
  const pass = $("adminPassword").value;

  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: ident, password: pass }),
  });

  const d = await r.json();
  if (!d.success) {
    return showModal("Chyba", d.error || "Přihlášení se nezdařilo.");
  }

  afterAuth(ident, d);
}

// -----------------------------------------------------
//  REGISTRACE
// -----------------------------------------------------
async function registerUser() {
  const ident = $("loginInput").value.trim();
  const pass = $("adminPassword").value;

  if (!ident || !pass) {
    return showModal("Chyba", "Vyplň jméno i heslo.");
  }

  const r = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: ident, password: pass }),
  });

  const d = await r.json();
  if (!d.success) return showModal("Chyba", d.error);

  afterAuth(ident, d);
}

// -----------------------------------------------------
//  LOGOUT
// -----------------------------------------------------
$("logoutBtn").onclick = () => {
  localStorage.removeItem("user");
  location.reload();
};



// ---------- DATUMY ----------
function populateDates() {
  const s = $("date");
  s.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const v = d.toISOString().slice(0, 10);
    s.innerHTML += `<option value="${v}">${v}</option>`;
  }

  s.onchange = loadMenu;
}

// ---------- NAČTENÍ JÍDEL ----------
async function loadFoods() {
  const r = await fetch("/api/foods");
  const foods = await r.json();

  $("foodsList").innerHTML = foods.map(f => `
    <div class="food-row">
      <div>
        <strong>${f.name}</strong><br>
        <span>${fmt(f.price)}</span>
      </div>
      <button class="btn btn-primary" onclick="addToDay(${f.id})">+</button>
    </div>
  `).join("");
}

// ---------- ADMIN MENU ----------
function renderAdminMenu(items) {
  $("adminDayMenu").innerHTML = items.map(i => `
    <div class="day-row">
      <strong>${i.name}</strong>
      <input type="number" value="${i.maxCount}" onchange="updateCount(${i.id},this.value)">
      <button onclick="removeFromDay(${i.id})">✕</button>
    </div>
  `).join("");
}

async function addToDay(foodId) {
  const date = $("adminDate").value;

  const r = await fetch("/api/admin/menu/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, foodId, maxCount: 30 }),
  });

  const d = await r.json();
  renderAdminMenu(d.items);
}

async function loadAdminMenu() {
  const date = $("adminDate").value;
  const r = await fetch("/api/admin/menu?date=" + date);
  const items = await r.json();
  renderAdminMenu(items);
}

async function updateCount(id, val) {
  await fetch("/api/admin/menu/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, maxCount: val }),
  });
}

async function removeFromDay(id) {
  await fetch("/api/admin/menu/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  loadAdminMenu();
}

// ---------- MENU + SKLAD ----------
async function loadMenu() {
  const date = $("date").value;
  const r = await fetch("/api/menu?date=" + date);
  const menu = await r.json();

  menuStock = {};
  menu.forEach(m => menuStock[m.name] = m.remaining);

  const list = $("menuList");
  list.innerHTML = "";

  menu.forEach(m => {
    const div = document.createElement("div");
    div.className = "menu-item" + (m.remaining === 0 ? " soldout" : "");
    div.innerHTML = `
      <strong>${m.name}</strong><br>
      ${fmt(m.price)} • ${m.remaining}/${m.maxCount}
    `;

    if (m.remaining > 0) {
      div.addEventListener("click", () => {
        addToCart(m.price, m.name);
      });
    }

    list.appendChild(div);
  });
}

function addToCart(price, name) {
  const inCart = cart.filter(i => i.name === name).length;

  if (inCart >= menuStock[name]) {
    showModal("Nelze objednat", "Toto jídlo už není dostupné.");
    return;
  }

  cart.push({ price, name });
  renderCart();
}

// ---------- KOŠÍK ----------
function renderCart() {
  const list = $("orderList");

  if (!cart.length) {
    list.innerHTML = `<li class="cart-empty">Košík je prázdný</li>`;
    return;
  }

  const grouped = {};
  cart.forEach(i => {
    if (!grouped[i.name]) grouped[i.name] = { count: 0, price: i.price };
    grouped[i.name].count++;
  });

  list.innerHTML = Object.entries(grouped).map(([name, info]) => `
    <li class="cart-row">
      <span class="cart-main">${info.count}× ${name}</span>
      <div class="cart-actions">
        <button class="btn btn-outline btn-sm" onclick='addToCart(${info.price}, ${JSON.stringify(name)})'>+</button>
        <button class="btn btn-outline btn-sm" onclick='changeCart(${JSON.stringify(name)}, ${info.price}, -1)'>−</button>
      </div>
    </li>
  `).join("");
}

function changeCart(name, price, delta) {
  if (delta < 0) {
    const idx = cart.findIndex(i => i.name === name);
    if (idx !== -1) cart.splice(idx, 1);
    renderCart();
  }
}

// ---------- OBJEDNÁVKA ----------
async function sendOrder() {
  if (!cart.length) {
    showModal("Košík je prázdný", "Před odesláním objednávky přidej nějaké jídlo.");
    return;
  }

  const r = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: currentUserId,
      date: $("date").value,
      items: cart,
    }),
  });

  const d = await r.json();

  if (!d.success) {
    showModal("Chyba", d.error);
    return;
  }

  $("credit").textContent = fmt(d.credit);
  cart = [];
  renderCart();
  loadMenu();
  showModal("Hotovo", "Objednávka byla úspěšně odeslána.");
}

// ---------- QR DOBÍJENÍ ----------
async function createQr() {
  const r = await fetch("/api/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: currentUserId,
      amount: $("topupAmount").value,
    }),
  });

  const d = await r.json();
  $("qr").innerHTML = `<img src="${d.qr}">`;

  if (topupInterval) clearInterval(topupInterval);

  topupInterval = setInterval(async () => {
    const s = await (await fetch("/api/topup/status?id=" + d.paymentId)).json();
    $("credit").textContent = fmt(s.credit);

    if (s.done) {
      clearInterval(topupInterval);
      topupInterval = null;
      showModal("Platba úspěšná", "Kredit byl připsán.");
    }
  }, 2000);
}

// ---------- MOJE OBJEDNÁVKY ----------
async function showMyOrders() {
  $("myOrders").classList.remove("hidden");

  const r = await fetch("/api/orders/history?userId=" + currentUserId);
  const orders = await r.json();

  if (!orders.length) {
    $("myOrdersList").innerHTML = "<p>Nemáš žádné objednávky.</p>";
    return;
  }

  $("myOrdersList").innerHTML = orders.map(o => {
    const grouped = {};
    const namesStr = o.itemNames || o.itemnames || "";
    namesStr.split(", ").forEach(i => {
      if (!i) return;
      grouped[i] = (grouped[i] || 0) + 1;
    });

    const itemsHtml = Object.entries(grouped)
      .map(([name, count]) => `${count}× ${name}`)
      .join("<br>");

    return `
      <div class="card">
        <strong>${o.date}</strong><br>
        ${itemsHtml}<br>
        <b>${fmt(o.price)}</b><br>
        <button class="btn btn-danger btn-sm" onclick="cancelOrder(${o.id})">
          Zrušit
        </button>
      </div>
    `;
  }).join("");
}

async function cancelOrder(orderId) {
  const r = await fetch("/api/orders/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId })
  });

  const d = await r.json();

  if (!d.success) {
    showModal("Chyba", d.error || "Zrušení se nezdařilo");
    return;
  }

  if (typeof d.credit === "number") {
    $("credit").textContent = fmt(d.credit);
  }

  showModal("Hotovo", "Objednávka byla zrušena.");
  await showMyOrders();
  loadMenu();
}

// ---------- ADMIN STATISTIKY – TRŽBY + TOP JÍDLA ----------
async function loadAdminStats() {
  const r = await fetch("/api/admin/stats/month");
  const d = await r.json();

  $("adminStats").innerHTML = `
    <h4>📊 Statistika za 30 dní</h4>
    <p><strong>Tržby:</strong> ${fmt(d.total)}</p>
    <strong>TOP jídla:</strong><br>
    ${d.topFoods.map(i => `${i[0]} – ${i[1]}×`).join("<br>")}
  `;
}

// ---------- DENNÍ SOUČET OBJEDNÁVEK ----------
async function loadDailyStats() {
  const date = $("statsDate").value;
  const r = await fetch("/api/admin/stats/day?date=" + date);
  const data = await r.json();

  let html = `<h4>📦 Součet objednávek na den</h4>`;
  for (let k in data) html += `${k} – ${data[k]}×<br>`;

  $("dailyStatsOutput").innerHTML = html || "<p>Žádné objednávky.</p>";
}

// ---------- EVENTS ----------
$("loginBtn").onclick = login;
const regBtn = $("registerBtn");
if (regBtn) {
  regBtn.onclick = registerUser;
}
$("sendOrderBtn").onclick = sendOrder;

// Dobít kredit – toggle + čištění QR
$("topupBtn").onclick = () => {
  const sec = $("topup");
  const isHidden = sec.classList.contains("hidden");
  if (isHidden) {
    sec.classList.remove("hidden");
  } else {
    sec.classList.add("hidden");
    $("qr").innerHTML = "";
    if (topupInterval) {
      clearInterval(topupInterval);
      topupInterval = null;
    }
  }
};

$("createQrBtn").onclick = createQr;

// Moje objednávky – toggle
$("myOrdersBtn2").onclick = () => {
  const sec = $("myOrders");
  if (sec.classList.contains("hidden")) {
    showMyOrders();
  } else {
    sec.classList.add("hidden");
  }
};
