const ordersDiv = document.getElementById("orders");
const logoutBtn = document.getElementById("logoutBtn");

// 🔐 token pro kuchyni
const token = localStorage.getItem("kitchen_token");

if (!token) {
  // nepřihlášen → login
  window.location.href = "/kitchen-login.html";
}

// logout
logoutBtn.onclick = () => {
  localStorage.removeItem("kitchen_token");
  window.location.href = "/kitchen-login.html";
};

// 🔄 načtení objednávek
async function loadOrders() {
  ordersDiv.innerHTML = "<p>Načítání objednávek…</p>";

  const res = await fetch("/api/kitchen/orders", {
    headers: {
      Authorization: "Bearer " + token,
    },
  });

  if (!res.ok) {
    ordersDiv.innerHTML = "<p>Chyba při načítání objednávek</p>";
    return;
  }

  const orders = await res.json();

  if (!orders.length) {
    ordersDiv.innerHTML = "<p>Žádné čekající objednávky</p>";
    return;
  }

  ordersDiv.innerHTML = orders
    .map(
      (o) => `
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:36px;font-weight:900;margin-bottom:6px">
          ${o.pickup_code}
        </div>

        <div style="margin-bottom:8px">
          ${o.itemnames.split(", ").join("<br>")}
        </div>

        <button
          class="btn btn-success"
          onclick="issueOrder(${o.id})"
          style="width:100%"
        >
          Vydáno
        </button>
      </div>
    `
    )
    .join("");
}

// 📦 potvrzení vydání
async function issueOrder(orderId) {
  if (!confirm("Potvrdit vydání objednávky?")) return;

  await fetch(`/api/kitchen/orders/${orderId}/issue`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
    },
  });

  loadOrders();
}

// první načtení
loadOrders();

// auto refresh každých 5 s
setInterval(loadOrders, 5000);
