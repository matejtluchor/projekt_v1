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

let currentOrders = [];

// 🔄 načtení objednávek (BEZ resetu DOMu)
async function loadOrders() {
  const res = await fetch("/api/kitchen/orders", {
    headers: {
      Authorization: "Bearer " + token,
    },
  });

  if (!res.ok) return;

  const orders = await res.json();

  // pokud se nic nezměnilo → nic nepřekresluj
  if (JSON.stringify(orders) === JSON.stringify(currentOrders)) return;

  currentOrders = orders;

  if (!orders.length) {
    ordersDiv.innerHTML = "<p>Žádné čekající objednávky</p>";
    return;
  }

  renderOrders(orders);
}

// 🎨 vykreslení objednávek
function renderOrders(orders) {
  ordersDiv.innerHTML = "";

  orders.forEach((o) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "16px";

    card.innerHTML = `
      <div style="font-size:28px;font-weight:800;margin-bottom:6px">
        ${o.pickup_code || "—"}
      </div>

      <div style="margin-bottom:10px">
        ${o.itemnames.split(", ").join("<br>")}
      </div>

      <button class="btn btn-success" style="width:100%">
        Vydáno
      </button>
    `;

    // ✅ TADY JE OPRAVA – event listener
    const btn = card.querySelector("button");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerText = "Vydávám…";

      const res = await fetch(`/api/kitchen/orders/${o.id}/issue`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
      });

      if (res.ok) {
        card.remove(); // ✅ okamžitě zmizí
        currentOrders = currentOrders.filter((x) => x.id !== o.id);
      } else {
        btn.disabled = false;
        btn.innerText = "Vydáno";
        alert("Chyba při vydání objednávky");
      }
    });

    ordersDiv.appendChild(card);
  });
}

// první načtení
loadOrders();

// background refresh (NEBLIKÁ)
setInterval(loadOrders, 5000);
