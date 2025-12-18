const $ = id => document.getElementById(id);

// -----------------------------------------------------
//  GLOBAL STATE
// -----------------------------------------------------
let isAdmin = false;
let cart = [];
let topupInterval = null;
let menuStock = {};
let authToken = null;

function fmt(v) {
  return v + " Kč";
}

// -----------------------------------------------------
//  FETCH WRAPPER – AUTOMATICKY PŘIDÁ JWT
// -----------------------------------------------------
async function api(url, options = {}) {
  options.headers = options.headers || {};
  options.headers["Content-Type"] = "application/json";

  if (authToken) {
    options.headers["Authorization"] = "Bearer " + authToken;
  }

  const r = await fetch(url, options);
  return r.json();
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
//  PO LOGINU / REGISTRACI
// -----------------------------------------------------

function afterAuth(identifier, data) {
  // uložíme JWT token do proměnné
  authToken = data.token;

  // role
  isAdmin = data.role === "admin" || data.role === "manager";

  // uložíme vše do localStorage (JEDNO místo pravdy)
  localStorage.setItem(
    "user",
    JSON.stringify({
      token: authToken,
      name: identifier,
      role: data.role,
      credit: data.credit,
    })
  );

  // UI – horní lišta
  $("loggedUser").textContent = "Uživatel: " + identifier;
  $("logoutBtn").classList.remove("hidden");

  // skrytí loginu, zobrazení uživatele
  $("login").classList.add("hidden");
  $("user").classList.remove("hidden");
  $("credit").textContent = fmt(data.credit);

  // menu + košík
  $("menu").classList.remove("hidden");
  $("order").classList.remove("hidden");

  // inicializace dat
  renderCart();
  populateDates();
  loadMenu();

  // ADMIN sekce
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
//  AUTO LOGIN
// -----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("user");
  if (!saved) return;

  const u = JSON.parse(saved);

  authToken = u.token;
  isAdmin = u.role === "admin" || u.role === "manager";

  $("loggedUser").textContent = "Uživatel: " + u.name;
  $("logoutBtn").classList.remove("hidden");

  $("login").classList.add("hidden");
  $("user").classList.remove("hidden");
  $("credit").textContent = fmt(u.credit);

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
});


// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
async function login() {
  const ident = $("loginInput").value.trim();
  const pass = $("adminPassword").value;

  const d = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ identifier: ident, password: pass }),
  });

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

  const d = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({ identifier: ident, password: pass }),
  });

  if (!d.success) return showModal("Chyba", d.error);

  afterAuth(ident, d);
}

// -----------------------------------------------------
//  LOGOUT
// -----------------------------------------------------
$("logoutBtn").onclick = () => {
  localStorage.removeItem("user");
  authToken = null;
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

// ---------- ADMIN: FOODS ----------
async function loadFoods() {
  const foods = await api("/api/foods");

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
  const d = await api("/api/admin/menu/add", {
    method: "POST",
    body: JSON.stringify({
      date: $("adminDate").value,
      foodId,
      maxCount: 30,
    }),
  });

  renderAdminMenu(d.items);
}

async function loadAdminMenu() {
  const items = await api("/api/admin/menu?date=" + $("adminDate").value);
  renderAdminMenu(items);
}

async function updateCount(id, val) {
  await api("/api/admin/menu/update", {
    method: "POST",
    body: JSON.stringify({ id, maxCount: val }),
  });
}

async function removeFromDay(id) {
  await api("/api/admin/menu/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  loadAdminMenu();
}

// ---------- MENU ----------
async function loadMenu() {
  const menu = await api("/api/menu?date=" + $("date").value);

  menuStock = {};
  menu.forEach(m => menuStock[m.name] = m.remaining);

  $("menuList").innerHTML = "";

  menu.forEach(m => {
    const div = document.createElement("div");
    div.className = "menu-item" + (m.remaining === 0 ? " soldout" : "");
    div.innerHTML = `
      <strong>${m.name}</strong><br>
      ${fmt(m.price)} • ${m.remaining}/${m.maxCount}
    `;

    if (m.remaining > 0) {
      div.onclick = () => addToCart(m.price, m.name);
    }

    $("menuList").appendChild(div);
  });
}

function addToCart(price, name) {
  if (cart.filter(i => i.name === name).length >= menuStock[name]) {
    return showModal("Nelze objednat", "Toto jídlo už není dostupné.");
  }
  cart.push({ price, name });
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, i) => sum + i.price, 0);
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
    grouped[i.name] = grouped[i.name] || { count: 0, price: i.price };
    grouped[i.name].count++;
  });

  const itemsHtml = Object.entries(grouped).map(([name, info]) => `
    <li class="cart-row">
      <span class="cart-main">${info.count}× ${name}</span>
      <div class="cart-actions">
        <button class="btn btn-outline btn-sm"
          onclick='addToCart(${info.price}, ${JSON.stringify(name)})'>+</button>
        <button class="btn btn-outline btn-sm"
          onclick='changeCart(${JSON.stringify(name)}, -1)'>−</button>
      </div>
    </li>
  `).join("");

  const totalHtml = `
    <li class="cart-row" style="border-top:2px solid #cbd5f5; margin-top:10px; font-weight:800">
      <span>Celkem</span>
      <span>${fmt(cartTotal())}</span>
    </li>
  `;

  list.innerHTML = itemsHtml + totalHtml;
}

function changeCart(name, delta) {
  if (delta < 0) {
    const idx = cart.findIndex(i => i.name === name);
    if (idx !== -1) cart.splice(idx, 1);
    renderCart();
  }
}

// ---------- OBJEDNÁVKA ----------
async function sendOrder() {
  if (!cart.length) {
    return showModal("Košík je prázdný", "Přidej jídlo.");
  }

  const d = await api("/api/order", {
    method: "POST",
    body: JSON.stringify({
      date: $("date").value,
      items: cart,
    }),
  });

  if (!d.success) return showModal("Chyba", d.error);

  $("credit").textContent = fmt(d.credit);
  cart = [];
  renderCart();
  loadMenu();
  showModal("Hotovo", "Objednávka byla odeslána.");
}

// ---------- QR TOPUP ----------
async function createQr() {
  const d = await api("/api/topup", {
    method: "POST",
    body: JSON.stringify({ amount: $("topupAmount").value }),
  });

  $("qr").innerHTML = `<img src="${d.qr}">`;

  if (topupInterval) clearInterval(topupInterval);

  topupInterval = setInterval(async () => {
    const s = await api("/api/topup/status?id=" + d.paymentId);
    $("credit").textContent = fmt(s.credit);

    if (s.done) {
      clearInterval(topupInterval);
      showModal("Platba úspěšná", "Kredit byl připsán.");
    }
  }, 2000);
}

// ---------- MOJE OBJEDNÁVKY ----------
async function showMyOrders() {
  $("myOrders").classList.remove("hidden");

  const orders = await api("/api/orders/history");

  // ✅ bezpečná kontrola
  if (!Array.isArray(orders) || orders.length === 0) {
    $("myOrdersList").innerHTML = "<p>Nemáš žádné objednávky.</p>";
    return;
  }

  $("myOrdersList").innerHTML = orders.map(o => {
    const namesStr = o.itemNames || "";
    const grouped = {};

    namesStr.split(", ").forEach(n => {
      if (!n) return;
      grouped[n] = (grouped[n] || 0) + 1;
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

// ---------- ZRUŠENÍ OBJEDNÁVKY ----------
async function cancelOrder(orderId) {
  const d = await api("/api/orders/cancel", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });

  if (!d.success) {
    return showModal("Chyba", d.error || "Zrušení se nezdařilo");
  }

  $("credit").textContent = fmt(d.credit);
  showModal("Hotovo", "Objednávka byla zrušena.");
  showMyOrders();
  loadMenu();
}

// ---------- ADMIN STATISTIKY ----------
async function loadAdminStats() {
  const d = await api("/api/admin/stats/month");

  $("adminStats").innerHTML = `
    <h4>📊 Statistika za 30 dní</h4>
    <p><strong>Tržby:</strong> ${fmt(d.total)}</p>
    ${d.topFoods.map(i => `${i[0]} – ${i[1]}×`).join("<br>")}
  `;
}

async function loadDailyStats() {
  const data = await api("/api/admin/stats/day?date=" + $("statsDate").value);

  let html = `<h4>📦 Součet objednávek na den</h4>`;
  for (let k in data) html += `${k} – ${data[k]}×<br>`;
  $("dailyStatsOutput").innerHTML = html;
}

// ---------- EVENTS ----------
$("loginBtn").onclick = login;
$("registerBtn").onclick = registerUser;
$("sendOrderBtn").onclick = sendOrder;
$("createQrBtn").onclick = createQr;

$("topupBtn").onclick = () => {
  $("topup").classList.toggle("hidden");
  $("qr").innerHTML = "";
};

$("myOrdersBtn2").onclick = () => {
  $("myOrders").classList.toggle("hidden");
};
