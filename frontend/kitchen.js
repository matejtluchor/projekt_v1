// -----------------------------------------------------
//  KITCHEN AUTH CHECK
// -----------------------------------------------------
const token = localStorage.getItem("kitchen_token");

if (!token) {
  // není přihlášená kuchyň → login
  window.location.href = "/kitchen-login.html";
}

// -----------------------------------------------------
//  UI INIT
// -----------------------------------------------------
document.getElementById("orders").innerHTML =
  "<p>Načítání objednávek…</p>";

// -----------------------------------------------------
//  LOGOUT
// -----------------------------------------------------
document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("kitchen_token");
  window.location.href = "/kitchen-login.html";
};
