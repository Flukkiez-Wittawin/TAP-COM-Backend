const rateLimit = require("express-rate-limit");

const bruteforceLimiter = rateLimit({
  windowMs: 1* 1000,
  max: 5,
  message: {
    status: 429,
    error: "Too many login attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { bruteforceLimiter };
