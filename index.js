// index.js (fixed)
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

// ===== ระบบ auth / users =====
const {
  CheckUsers,
  Register,
  VerifyPassword,
} = require("./system/login_system");
const { GenerateToken, CheckAvalableToken } = require("./system/jwt_token");

// ===== Products / uploads =====
const {
  UpdateProductData,
  LoadProductsData,
  GetProducts,
  UploadProductData,
} = require("./system/products_system");
const { Upload, UploadToDatabase } = require("./system/upload_system");

// ===== Forgot password (แยกไฟล์ใหม่) =====
const {
  RequestPasswordReset,
  VerifyPasswordResetCode,
  ResetPasswordWithCode,
} = require("./system/forgot_password_system");

// ===== อีเมล =====
const { SendMailer_Auto } = require("./system/Sender/EmailSender_system");

// ===== Users mgmt / logs / misc =====
const {
  GetUser,
  IncrementUserWin,
  IncrementUsersLose,
} = require("./system/manage_user_system");
const {
  AddDataToCurrentWin,
} = require("./system/AddData/CurrentWinUser_system");
const { UpdateProfile } = require("./system/profile_system");
const { AddDataToLog } = require("./system/logs_system");
const { getCurrentDate } = require("./system/Date/date_system");

// ===== Bruteforce limiter ของคุณ =====
const { bruteforceLimiter } = require("./Security/Bruteforce");

// ------------------- App & Socket Setup -------------------
const app = express();
const server = http.createServer(app);

app.use(express.json());

// ให้ Express เชื่อ proxy (เช่น Render) เพื่อให้ req.protocol ถูกต้องเป็น https
app.set("trust proxy", 1);

// ✅ ใช้พอร์ตจาก Render/Platform เสมอ
const PORT = Number(process.env.PORT || 3001);

// ✅ รองรับหลาย origin (dev + prod)
// ตั้ง ENV: FRONT_ORIGINS="http://localhost:5173,https://your-frontend-domain"
const FRONT_ORIGINS = (process.env.FRONT_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ตั้ง CORS ที่เดียวให้ครอบคลุม ทั้ง REST และ Socket.IO
app.use(
  cors({
    origin: FRONT_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

const io = new Server(server, {
  cors: {
    origin: FRONT_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// ------------------- Utils / Validators -------------------
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const strongPwdRegex =
  /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>_])[A-Za-z\d!@#$%^&*(),.?":{}|<>_]{8,}$/;

// base URL helper เพื่อเลิก hardcode localhost
function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

function uniqueNormalizedEmails(list = []) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const n = normalizeEmail(e);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function pushCurrentEmail(product, email) {
  const em = normalizeEmail(email);
  if (!em) return;
  const arr = Array.isArray(product.CurrentEmail) ? product.CurrentEmail : [];
  if (!arr.some((x) => normalizeEmail(x) === em)) arr.push(em);
  product.CurrentEmail = arr;
}

function isExpired(product) {
  if (!product?.endAt) return false;
  const end = new Date(product.endAt).getTime();
  if (Number.isNaN(end)) return false;
  return Date.now() >= end;
}

// ส่งเมลแบบไม่ให้ล้ม flow
async function SendMailerAuto(email, type, payload) {
  try {
    const result = await SendMailer_Auto(email, type, payload);
    return !!result?.success;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}

// ------------------- In-memory products cache -------------------
const products = {};

// ------------------- Auction Logic -------------------
async function Success_Aunction(highestBidder, aunction_owner, productId) {
  try {
    const bidderEmail = normalizeEmail(highestBidder);
    const ownerEmail = normalizeEmail(aunction_owner);
    if (!bidderEmail) throw new Error("highestBidder missing");
    if (!ownerEmail) throw new Error("aunction_owner missing");

    const bidder = await GetUser(bidderEmail);
    if (!bidder) throw new Error(`Bidder not found: ${bidderEmail}`);

    const updated = await IncrementUserWin(bidderEmail);
    console.log(`Auction success -> ${updated.email} Win=${updated.win}`);

    const addCurrentData = await AddDataToCurrentWin(bidderEmail, productId);
    console.log(
      `AddDataToCurrentWin -> ${addCurrentData.email} Win=${addCurrentData.win}`
    );

    await Promise.allSettled([
      SendMailerAuto(ownerEmail, "CanSell"),
      SendMailerAuto(bidderEmail, "GotIt"),
    ]);

    return true;
  } catch (err) {
    console.error("Success_Aunction error:", err);
    return false;
  }
}

async function onHighestBidderChanged(prevBidder, newBidder, isFinal) {
  const tasks = [];
  if (prevBidder) tasks.push(SendMailerAuto(prevBidder, "OutBid"));
  if (!isFinal && newBidder) tasks.push(SendMailerAuto(newBidder, "TopBidder"));
  if (tasks.length) await Promise.allSettled(tasks);
}

async function finalizeAuction(productId) {
  try {
    const pid = String(productId);
    const p = products[pid];
    if (!p) return;
    if (p.type === "success") return; // กันซ้ำ
    p.type = "success"; // pre-mark

    const winner = normalizeEmail(p.highestBidder || "");
    const participants = uniqueNormalizedEmails(p.CurrentEmail || []);
    const losers = participants.filter((e) => e && e !== winner);

    if (winner) {
      await Success_Aunction(winner, p.aunction_owner, productId);
    }

    if (losers.length) {
      await Promise.allSettled(
        losers.map((e) => SendMailerAuto(e, "AuctionLost"))
      );
    }

    if (participants.length) {
      try {
        await IncrementUsersLose(participants, { exclude: [winner] });
      } catch (e) {
        console.error("IncrementUsersLose error:", e);
      }
    }

    io.to(pid).emit("update", p);
    UpdateProductData(products);
  } catch (err) {
    console.error("finalizeAuction error:", err);
  }
}

// สแกนจบงานทุก ๆ 5 วิ
setInterval(async () => {
  try {
    for (const [pid, p] of Object.entries(products)) {
      if (!p) continue;
      if (p.type === "success") continue;
      if (isExpired(p)) {
        await finalizeAuction(pid);
      }
    }
  } catch (e) {
    console.error("expiry sweeper error:", e);
  }
}, 5000);

// ------------------- Socket.IO -------------------
io.on("connection", (socket) => {
  socket.emit("products:init", products);

  socket.on("join", async (rawId) => {
    const productId = String(rawId);
    socket.join(productId);

    let product = products[productId];
    if (!product) {
      try {
        const list = await GetProducts();
        if (Array.isArray(list)) {
          for (const p of list) {
            if (p && typeof p.id !== "undefined") {
              products[String(p.id)] = p;
            }
          }
          product = products[productId];
        }
      } catch (e) {
        console.error("lazy load products failed:", e);
      }
    }

    if (!product) {
      socket.emit("update:error", { productId, message: "Product not found" });
      return;
    }

    if (isExpired(product) && product.type !== "success") {
      await finalizeAuction(productId);
    } else {
      socket.emit("update", product);
    }
  });

  socket.on("increment", async (productId, user) => {
    const pid = String(productId);
    const p = products[pid];
    if (!p) return;

    const owner = normalizeEmail(p.aunction_owner || "");
    const bidder = normalizeEmail(user || "");
    if (owner && bidder && owner === bidder) return;

    const prev = normalizeEmail(p.highestBidder || "");

    p.value = Number(p.value) + Number(p.bit);
    p.UserClick = (p.UserClick || 0) + 1;
    p.highestBidder = bidder;
    pushCurrentEmail(p, bidder);

    const isFinal = p.value >= Number(p.max) || isExpired(p);

    if (bidder && bidder !== prev) {
      try {
        await onHighestBidderChanged(prev, bidder, isFinal);
      } catch (e) {
        console.error("notify change highestBidder:", e);
      }
    }

    if (isFinal) {
      await finalizeAuction(pid);
    } else {
      io.to(pid).emit("update", p);
      UpdateProductData(products);
    }
  });

  socket.on("CustomIncrement", async (productId, user, CustomBit) => {
    const pid = String(productId);
    const p = products[pid];
    if (!p) return;

    const owner = normalizeEmail(p.aunction_owner || "");
    const bidder = normalizeEmail(user || "");
    if (owner && bidder && owner === bidder) return;

    const prev = normalizeEmail(p.highestBidder || "");

    p.value = Number(CustomBit);
    p.UserClick = (p.UserClick || 0) + 1;
    p.highestBidder = bidder;
    pushCurrentEmail(p, bidder);

    const isFinal = p.value >= Number(p.max) || isExpired(p);

    if (bidder && bidder !== prev) {
      try {
        await onHighestBidderChanged(prev, bidder, isFinal);
      } catch (e) {
        console.error("notify change highestBidder:", e);
      }
    }

    if (isFinal) {
      await finalizeAuction(pid);
    } else {
      io.to(pid).emit("update", p);
      UpdateProductData(products);
    }
  });
});

// ------------------- Static Files -------------------
// รูปสินค้า
const imagesDir = path.join(__dirname, "Uploads", "Images");
fs.mkdirSync(imagesDir, { recursive: true });
app.use("/get/upload", express.static(imagesDir, { fallthrough: false }));

// รูปโปรไฟล์
const profileDir = path.join(__dirname, "Uploads", "Profile");
fs.mkdirSync(profileDir, { recursive: true });
app.use("/static/profile", express.static(profileDir));

// ------------------- Multer (โปรไฟล์) -------------------
const storageProfile = multer.diskStorage({
  destination: (req, file, cb) => cb(null, profileDir),
  filename: (req, file, cb) => {
    const ext = (file.originalname || "").split(".").pop();
    cb(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext || "jpg"}`
    );
  },
});
const uploadProfile = multer({ storage: storageProfile });

// ------------------- Routes -------------------
// อัปเดตโปรไฟล์
// สมมติคุณมี auth middleware ที่เติม req.user.email มาจาก JWT
// และมี uploadProfile (multer) แล้ว

app.post(
  "/profile/update",
  uploadProfile.single("avatar"),
  async (req, res) => {
    try {
      // 1) รองรับทั้ง multipart และ JSON:
      // - ถ้าเป็น multipart: multer จะเติม req.body ให้เป็น string ล้วน
      // - ถ้าเป็น JSON: ให้แน่ใจว่า app.use(express.json()) ถูกประกาศไว้ก่อน routes
      const b = req.body || {};

      // 2) ดึง email จาก JWT ก่อน (ปลอดภัยกว่า body), ถ้าไม่มีค่อย fallback
      const emailFromJwt = (req.user?.email || b.email || "").trim().toLowerCase();
      const idFromBody   = String(b.ID ?? "").trim(); // บางระบบเก็บเป็น "123" อย่า parseInt

      if (!emailFromJwt && !idFromBody) {
        return res.status(400).json({ success:false, message:"Missing identifier (email or ID)" });
      }

      // 3) สร้าง profileUrl ถ้ามีไฟล์
      const profileUrl = req.file
        ? `${getBaseUrl(req)}/static/profile/${req.file.filename}`
        : undefined;

      // 4) เตรียม payload (แปลงเป็น camelCase และ trim)
      const toStr = (v) => (typeof v === "string" ? v.trim() : v);
      const payload = {
        firstName:   toStr(b.firstName),
        lastName:    toStr(b.lastName),
        birthDay:    toStr(b.birthDay),
        alreadyCheck: b.alreadyCheck,      // boolean/"true"/"false" ให้ไป normalize ใน UpdateProfile
        isOnBlacklist: b.isOnBlacklist,
        country:     toStr(b.country),
        phoneNumber: toStr(b.phoneNumber),
        address:     toStr(b.address),
        line:        toStr(b.line),
        facebook:    toStr(b.facebook),
        instagram:   toStr(b.instagram),
        twitter:     toStr(b.twitter),
        youtube:     toStr(b.youtube),
        tiktok:      toStr(b.tiktok),
      };

      // 5) เรียก service (ใช้ email จาก JWT เป็นหลัก)
      const result = await UpdateProfile(
        { id: idFromBody, email: emailFromJwt },
        payload,
        { profileUrl }
      );

      // 6) เขียน log (อย่าไว้ใจ ID ถ้าไม่เจอ user)
      try {
        const currentDate = await getCurrentDate();
        AddDataToLog(
          `ID : TAP.COM-${idFromBody || "?"} | ${emailFromJwt || "?"} Update profile @ ${currentDate}`
        );
      } catch (err) {
        console.error("AddDataToLog error:", err);
      }

      return res.status(result.success ? 200 : 404).json(result);
    } catch (e) {
      console.error("profile/update error:", e);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// โหลดสินค้าทั้งหมด
app.get("/All_Products", async (req, res) => {
  try {
    const list = await GetProducts();
    return res.json(list);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load products" });
  }
});

// ดึงข้อมูลผู้ใช้จากอีเมล
app.post("/data/user", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !emailRegex.test(String(email)))
      return res.status(400).json({ success: false, message: "Invalid email" });

    const listUser = await GetUser(email);
    res.json(listUser);
  } catch (e) {
    console.error("data/user error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ล็อกอิน
app.post("/login", bruteforceLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res
      .status(400)
      .json({ success: false, message: "Missing email or password" });

  try {
    const user = await CheckUsers(email);
    if (!user || !user.hashedPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Username หรือ Password ผิด" });
    }

    const passwordMatch = await VerifyPassword(password, user.hashedPassword);
    if (!passwordMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Username หรือ Password ผิด" });
    }

    const token = await GenerateToken({ ...user });
    return res
      .status(200)
      .json({ success: true, message: "Login Successfully!", token });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// สมัครสมาชิก
app.post("/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName, ip } = req.body || {};

    if (!email || !emailRegex.test(String(email)))
      return res.status(400).json({ success: false, message: "Invalid email" });

    if (!password)
      return res
        .status(400)
        .json({ success: false, message: "Please enter password" });

    if (!strongPwdRegex.test(String(password)))
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters long and include at least one uppercase letter and one special character.",
      });

    const newUser = await Register(email, password, firstName, lastName, ip);
    return res.status(newUser?.success ? 200 : 400).json({ ...newUser });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ตรวจ session token
app.post("/session", async (req, res) => {
  const { token } = req.body || {};
  try {
    const TokenCheck = await CheckAvalableToken(token);
    return res
      .status(TokenCheck.valid ? 200 : 400)
      .json({ status: TokenCheck.valid, message: TokenCheck });
  } catch (err) {
    console.error("session error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// อัปโหลดสินค้า (หลายไฟล์)
app.post("/upload", Upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No files uploaded" });
    }

    const {
      email,
      name,
      title,
      description,
      bidMin,
      bidMax,
      bidStep,
      category,
      tag,
      durationDays,
    } = req.body;

    const base = getBaseUrl(req);
    const fileLinks = req.files.map((f) => `${base}/get/upload/${f.filename}`);

    const info = String(title || "").trim();
    const value = Number(bidMin);
    const bit = Number(bidStep);
    const max = Number(bidMax);
    const ownerName = name || email || "unknown@example.com";
    const productType = tag || category || "ไม่ระบุ";

    const daysNum = Math.max(0, Number(durationDays || 0));
    const startedAt = new Date();
    const endAt =
      daysNum > 0
        ? new Date(startedAt.getTime() + daysNum * 24 * 60 * 60 * 1000)
        : null;

    const result = await UploadProductData(
      info,
      value,
      bit,
      max,
      ownerName,
      productType,
      fileLinks,
      {
        description: description || "",
        category: category || "",
        startedAt: startedAt.toISOString(),
        endAt: endAt ? endAt.toISOString() : null,
      }
    );

    if (result.success && result.data) {
      const p = result.data;
      const pid = String(p.id);
      products[pid] = { ...p };
      io.emit("product:new", products[pid]);
      io.emit("products:changed", products);
      io.to(pid).emit("update", products[pid]);
    }

    return res.json({
      success: result.success,
      message: result.message,
      uploaded: req.files.length,
      files: req.files.map((f) => ({
        filename: f.filename,
        path: `/get/upload/${f.filename}`,
      })),
      product: result.data,
    });
  } catch (err) {
    console.error("Upload route error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ส่งเมลแบบ auto
app.post("/send-mail", async (req, res) => {
  const { email, subject } = req.body || {};
  try {
    const result = await SendMailer_Auto(email, subject);
    if (result?.success) {
      return res.json({ success: true, message: "Email sent successfully" });
    } else {
      return res.json({ success: false, message: "Failed to send email" });
    }
  } catch (error) {
    console.error("Error sending email:", error);
    return res.json({ success: false, message: "Error sending email" });
  }
});

// ------------------- Forgot Password Routes -------------------
const forgotLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 นาที
  max: 5,                   // ต่อ IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, _res) => req.ip, // ใช้ IP หลัง trust proxy
  message: { success: false, message: "Too many forgot attempts. Try again later." },
});


// Step 1: ขอรหัสรีเซ็ต
app.post("/forgot/request", forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !emailRegex.test(String(email)))
      return res.status(400).json({ success: false, message: "Invalid email" });

    const result = await RequestPasswordReset(email);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (e) {
    console.error("POST /forgot/request error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Step 2: ยืนยันโค้ด
app.post("/forgot/verify", forgotLimiter, async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !emailRegex.test(String(email)))
      return res.status(400).json({ success: false, message: "Invalid email" });
    if (!code || String(code).trim().length < 4)
      return res.status(400).json({ success: false, message: "Invalid code" });

    const result = await VerifyPasswordResetCode(email, code);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (e) {
    console.error("POST /forgot/verify error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Step 3: ตั้งรหัสผ่านใหม่
app.post("/forgot/reset", forgotLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};
    if (!email || !emailRegex.test(String(email)))
      return res.status(400).json({ success: false, message: "Invalid email" });
    if (!code || String(code).trim().length < 4)
      return res.status(400).json({ success: false, message: "Invalid code" });
    if (!newPassword || !strongPwdRegex.test(String(newPassword)))
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters long and include at least one uppercase letter and one special character.",
      });

    const result = await ResetPasswordWithCode(email, code, newPassword);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (e) {
    console.error("POST /forgot/reset error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ------------------- Start Server -------------------
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
  LoadProductsData(products);
});
