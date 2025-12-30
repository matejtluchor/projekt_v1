const ordersDiv = document.getElementById("orders");
const logoutBtn = document.getElementById("logoutBtn");

// 🔐 token pro kuchyni
const token = localStorage.getItem("kitchen_token");

if (!token) {
  window.location.href = "/kitchen-login.html";
}

// logout
logoutBtn.onclick = () => {
  localStorage.removeItem("kitchen_token");
  window.location.href = "/kitchen-login.html";
};

// 🧠 aktuální stav objednávek (pro porovnání)
let currentOrders = [];

// -----------------------------------------------------
// NAČTENÍ OBJEDNÁVEK (bez refresh flickeru)
// -----------------------------------------------------
async function loadOrders() {
  try {
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

    // 🔁 pokud se nic nezměnilo → NIC nedělej
    if (JSON.stringify(orders) === JSON.stringify(currentOrders)) {
      return;
    }

    currentOrders = orders;
    renderOrders(orders);

  } catch (err) {
    ordersDiv.innerHTML = "<p>Chyba připojení k serveru</p>";
  }
}

// -----------------------------------------------------
// VYKRESLENÍ OBJEDNÁVEK
// -----------------------------------------------------
function renderOrders(orders) {
  if (!orders.length) {
    ordersDiv.innerHTML = "<p>Žádné čekající objednávky</p>";
    return;
  }

  ordersDiv.innerHTML = orders.map(o => `
    <div class="card kitchen-order" style="margin-bottom:16px">

      <div style="font-size:34px;font-weight:900;margin-bottom:6px">
        ${o.pickup_code || "—"}
      </div>

      <div style="margin-bottom:12px;line-height:1.5">
        ${o.itemnames.split(", ").join("<br>")}
      </div>

      <button
        class="btn btn-success"
        style="width:100%"
        onclick="confirmIssueOrder(${o.id})"
      >
        Vydáno
      </button>
    </div>
  `).join("");
}

// -----------------------------------------------------
// CONFIRM MODAL – VYDÁNÍ OBJEDNÁVKY
// -----------------------------------------------------
function confirmIssueOrder(orderId) {
  showConfirmModal(
    "Vydat objednávku?",
    "Potvrďte, že objednávka byla vydána zákazníkovi.",
    async () => {
      const res = await fetch(`/api/kitchen/orders/${orderId}/issue`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
      });

      if (!res.ok) {
        return showModal("Chyba", "Nepodařilo se označit jako vydané");
      }

      // 🗑️ okamžitě odeber z UI (bez reloadu)
      currentOrders = currentOrders.filter(o => o.id !== orderId);
      renderOrders(currentOrders);
    }
  );
}

// -----------------------------------------------------
// INIT
// -----------------------------------------------------
loadOrders();

// 🔄 auto refresh každých 5 s (bez skákání)
setInterval(loadOrders, 5000);
