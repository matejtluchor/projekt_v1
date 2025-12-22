# Projekt Jídelna 🍽️

Webová aplikace pro správu jídelny – objednávání jídel, správa menu,
uživatelské účty s kreditem a administrace.

## 🌐 Produkční verze
- Frontend + Backend: https://jidelnaapp.eu

## ⚙️ Použité technologie
### Backend
- Node.js
- Express
- PostgreSQL
- JWT (JSON Web Token)
- bcrypt
- rate-limit
- Render (deploy)

### Frontend
- HTML
- CSS
- Vanilla JavaScript

## 🔐 Funkce aplikace
- Registrace a přihlášení uživatelů
- Role: uživatel / admin
- Objednávání jídel z menu
- Rušení objednávek
- Kreditní systém
- Dobíjení kreditu (simulace QR)
- Admin správa menu a statistik
- Zabezpečení pomocí JWT a rate-limitu

## ▶️ Spuštění projektu lokálně

### Backend
```bash
cd backend
npm install
npm start
