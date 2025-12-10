const $ = (id) => document.getElementById(id);

let currentUserId = null;
let isAdmin = false;
let cart = [];
let topupInterval = null;
let menuStock = {};

function fmt(v) {
  return v + " Kč";
}

// ---------- MODAL ----------
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

// ---------- ADMIN PASSWORD ----------
setInterval(() => {
  const val = $("loginInput").value.trim();
  $("adminPassword").classList.toggle(
    "hidden",
    !["admin", "manager"].includes(val)
  );
}, 200);

// ---------- LOGIN ----------
async function login() {
  const ident = $("loginInput").value.trim();
  const pass = $("adminPassword").value;

  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: ident, password: pass }),
  });

  const d = await r.json();
  if (!d.success) return showModal("Chyba", d.error);

  currentUserId = d.userId;
  isAdmin = d.role === "admin" || d.role === "manager";

  $("loggedUser").textContent = "Uživatel: " + ident;
  $("logoutBtn").classList.remove("hidden");

  $("login").classList.add("hidden");
  $("user").classList.remove("hidden");
  $("credit").textContent = fmt(d.credit);

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

// ---------- LOGOUT ----------
$("logoutBtn").onclick = () => location.reload();

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

// ---------- FOODS ----------
async function loadFoods() {
  const r = await fetch("/api/foods");
  const foods = await r.json();

  $("foodsList").innerHTML = foods
    .map(
      (f) => `
    <div class="food-row">
      <div>
        <strong>${f.name}</strong><br>
        <span>${fmt(f.price)}</span>
      </div>
      <button class="btn btn-primary" onclick="addToDay(${f.id})">+</button>
    </div>
  `
    )
    .join("");
}

// ---------- ADMIN MENU ----------
function renderAdminMenu(items) {
  $("adminDayMenu").innerHTML = items
    .map(
      (i) => `
    <div class="day-row">
      <strong>${i.name}</strong>
      <input type="number" value="${i.maxcount}" onchange="updateCount(${i.id},this.value)">
      <button onclick="removeFromDay(${i.id})">✕</button>
    </div>
  `
    )
    .join("");
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

// ---------- MENU ----------
async function loadMenu() {
  const date = $("date").value;
  const r = await fetch("/api/menu?date=" + date);
  const menu = await r.json();

  menuStock = {};
  menu.forEach((m) => (menuStock[m.name] = m.remaining));

  $("menuList").innerHTML = menu
    .map((m) => {
      return `
      <div class="menu-item ${m.remaining === 0 ? "soldout" : ""}" 
           onclick='${m.remaining > 0 ? `addToCart(${m.price}, "${m.name}")` : ""}'>
        <strong>${m.name}</strong><br>
        ${fmt(m.price)} • ${m.remaining}/${m.maxCount}
      </div>
    `;
    })
    .join("");
}

// ---------- KOŠÍK ----------
function addToCart(price, name) {
  const inCart = cart.filter((i) => i.name === name).length;

  if (inCart >= menuStock[name]) {
    showModal("Nelze objednat", "Toto jídlo už není dostupné.");
    return;
  }

  cart.push({ price, name });
  renderCart();
}

function renderCart() {
  const list = $("orderList");

  if (!cart.length) {
    list.innerHTML = `<li class="cart-empty">Košík je prázdný</li>`;
    return;
  }

  const grouped = {};
  cart.forEach((i) => {
    if (!grouped[i.name]) grouped[i.name] = { count: 0, price: i.price };
    grouped[i.name].count++;
  });

  list.innerHTML = Object.entries(grouped)
    .map(
      ([name, info]) => `
    <li class="cart-row">
      <span class="cart-main">${info.count}× ${name}</span>
      <div class="cart-actions">
        <button class="btn btn-outline btn-sm" onclick='addToCart(${info.price}, "${name}")'>+</button>
        <button class="btn btn-outline btn-sm" onclick='changeCart("${name}", ${info.price}, -1)'>−</button>
      </div>
    </li>
  `
    )
    .join("");
}

function changeCart(name) {
  const idx = cart.findIndex((i) => i.name === name);
  if (idx !== -1) cart.splice(idx, 1);
  renderCart();
}

// ---------- ODESLÁNÍ OBJEDNÁVKY ----------
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

  if (!d.success) return showModal("Chyba", d.error);

  $("credit").textContent = fmt(d.credit);
  cart = [];
  renderCart();
  loadMenu();
  showModal("Hotovo", "Objednávka byla úspěšně odeslána.");
}

// ---------- DOBÍJENÍ ----------
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
    const s = await (
      await fetch("/api/topup/status?id=" + d.paymentId)
    ).json();

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
  const box = $("myOrders");

  // toggle
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");

  const r = await fetch("/api/orders/history?userId=" + currentUserId);
  const orders = await r.json();

  if (!orders.length) {
    $("myOrdersList").innerHTML = "<p>Nemáš žádné objednávky.</p>";
    return;
  }

  $("myOrdersList").innerHTML = orders
    .map((o) => {
      const grouped = {};
      o.itemnames.split(", ").forEach((n) => {
        grouped[n] = (grouped[n] || 0) + 1;
      });

      return `
      <div class="card">
        <strong>${o.date}</strong><br>
        ${Object.entries(grouped)
          .map(([n, c]) => `${c}× ${n}`)
          .join("<br>")}
        <br><br>
        <strong>${fmt(o.price)}</strong><br><br>
        <button class="btn btn-danger btn-sm" onclick="cancelOrder(${o.id})">
          Zrušit objednávku
        </button>
      </div>`;
    })
    .join("");
}

async function cancelOrder(orderId) {
  const r = await fetch("/api/orders/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });

  const d = await r.json();

  if (!d.success) {
    showModal("Chyba", d.error || "Zrušení objednávky se nezdařilo.");
    return;
  }

  if (d.credit !== undefined) {
    $("credit").textContent = fmt(d.credit);
  }

  showModal("Hotovo", "Objednávka byla zrušena.");
  showMyOrders();
  loadMenu();
}

// ---------- ADMIN STATISTIKY ----------
async function loadAdminStats() {
  const r = await fetch("/api/admin/stats/month");
  const d = await r.json();

  $("adminStats").innerHTML = `
    <h4>📊 Statistika za 30 dní</h4>
    <p><strong>Tržby:</strong> ${fmt(d.total)}</p>
    <strong>TOP jídla:</strong><br>
    ${d.topFoods.map((i) => `${i[0]} – ${i[1]}×`).join("<br>")}
  `;
}

// ---------- DENNÍ STATISTIKA ----------
async function loadDailyStats() {
  const r = await fetch("/api/admin/stats/day?date=" + $("statsDate").value);
  const d = await r.json();

  $("dailyStatsOutput").innerHTML = Object.keys(d).length
    ? Object.entries(d)
        .map(([name, count]) => `${name} – ${count}×`)
        .join("<br>")
    : "Žádné objednávky.";
}

// ---------- BUTTONS ----------
$("loginBtn").onclick = login;
$("sendOrderBtn").onclick = sendOrder;

$("topupBtn").onclick = () => {
  const sec = $("topup");
  if (sec.classList.contains("hidden")) {
    sec.classList.remove("hidden");
  } else {
    sec.classList.add("hidden");
    $("qr").innerHTML = "";
    if (topupInterval) clearInterval(topupInterval);
  }
};

$("createQrBtn").onclick = createQr;

// moje objednávky toggle
$("myOrdersBtn2").onclick = () => {
  const sec = $("myOrders");
  if (sec.classList.contains("hidden")) showMyOrders();
  else sec.classList.add("hidden");
};
