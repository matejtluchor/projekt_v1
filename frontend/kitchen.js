// jednoduchý test, že se stránka načte
document.getElementById("orders").innerHTML =
  "<p>Načítání objednávek…</p>";

document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("token");
  location.href = "/";
};
