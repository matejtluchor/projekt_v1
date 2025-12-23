const loginBtn = document.getElementById("loginBtn");

loginBtn.onclick = async () => {
  const identifier = document.getElementById("loginInput").value.trim();
  const password = document.getElementById("passwordInput").value;

  if (!identifier || !password) {
    alert("Vyplň jméno i heslo");
    return;
  }

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  const data = await res.json();

  if (!data.success) {
    alert(data.error || "Přihlášení se nezdařilo");
    return;
  }

  // 🔐 POVOLENÉ ROLE
  if (!["admin", "manager", "kitchen"].includes(data.role)) {
    alert("Nemáš oprávnění pro kuchyni");
    return;
  }

  // uložíme JINÝ token než hlavní appka
  localStorage.setItem("kitchen_token", data.token);

  // přesměrování do kuchyně
  window.location.href = "/kitchen.html";
};
