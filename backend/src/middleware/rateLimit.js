const rateLimit = require("express-rate-limit");

exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 50,                 // max 50 pokusů
  message: {
    success: false,
    error: "Příliš mnoho pokusů, zkus to později",
  },
});
