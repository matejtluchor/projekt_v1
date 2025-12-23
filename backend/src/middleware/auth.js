const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) {
    return res.status(401).json({ success: false, error: "Chybí token" });
  }

  const token = h.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Neplatný token" });
  }
}

function adminOnly(req, res, next) {
  if (!["admin", "manager", "kitchen"].includes(req.user.role)) {
    return res.status(403).json({ success: false, error: "Zakázáno" });
  }
  next();
}

module.exports = { auth, adminOnly };
