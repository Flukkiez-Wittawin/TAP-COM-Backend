require("dotenv").config();
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "secret";

const GenerateToken = async (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
};

const CheckAvalableToken = async (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, decoded };
  } catch (err) {
    return { valid: false, message: "Invalid or expired token" };
  }
};

module.exports = { GenerateToken, CheckAvalableToken };
