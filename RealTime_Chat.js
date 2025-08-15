// chat_server.js (fixed & hardened)
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs").promises;
const path = require("path");

// ---- ใช้ตัวตรวจ JWT เดิมของคุณ ----
const { CheckAvalableToken } = require("./system/jwt_token");

// ===== Config =====
const PORT = Number(process.env.PORT || process.env.PORT_CHAT || 3002);

// รองรับหลาย origin (dev + prod) ด้วยตัวแปรแยกด้วย comma
// ตัวอย่าง: FRONT_ORIGINS="http://localhost:5173,https://your-frontend.com"
const FRONT_ORIGINS = (process.env.FRONT_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// โฟลเดอร์เก็บประวัติแชท (ไฟล์ละ product)
const CHATS_DIR = path.join(__dirname, "Chats");
const HISTORY_PAGE_SIZE = 50;
const MESSAGE_MAX_LEN = 2000;

// ===== Bootstrap storage dir =====
(async () => {
  await fs.mkdir(CHATS_DIR, { recursive: true });
})().catch(console.error);

// ===== App / Server =====
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.set("trust proxy", 1); // ให้ req.protocol ถูก (เช่นหลัง proxy/Render)

// CORS ให้ตรงกันทั้ง REST และ Socket
app.use(
  cors({
    origin: FRONT_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ===== Utilities =====
const safeIdRegex = /^[\w-]+$/; // กัน path traversal
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function safeProductId(pid) {
  const s = String(pid || "");
  return safeIdRegex.test(s) ? s : null;
}

function roomName(productId) {
  return `product:${String(productId)}`;
}

function fileForRoom(productId) {
  return path.join(CHATS_DIR, `${String(productId)}.json`);
}

async function loadRoom(productId) {
  try {
    const f = fileForRoom(productId);
    const raw = await fs.readFile(f, "utf-8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

// serialize การเขียนไฟล์กัน race (พร้อมกันหลาย message)
const saveQueues = new Map();
async function saveRoomQueued(productId, messages) {
  const key = String(productId);
  const prev = saveQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {}) // ไม่ให้ chain พังถ้าอันก่อน error
    .then(async () => {
      const f = fileForRoom(productId);
      // เขียนไฟล์แบบ pretty เพื่ออ่านง่าย (จะใหญ่ขึ้นเล็กน้อย)
      await fs.writeFile(f, JSON.stringify(messages, null, 2), "utf-8");
    })
    .finally(() => {
      // ถ้า next ถูก resolve แล้ว และ queue ยังชี้มาที่ next ก็ลบทิ้ง
      if (saveQueues.get(key) === next) saveQueues.delete(key);
    });

  saveQueues.set(key, next);
  return next;
}

function nowISO() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeText(s) {
  const t = String(s || "");
  // เอาเฉพาะข้อความดิบ ๆ กัน XSS ฝั่ง client (แนะนำให้ escape ที่ frontend เพิ่มด้วย)
  return t.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, MESSAGE_MAX_LEN);
}

// ===== REST (optional) =====
app.get("/health", (_req, res) => res.json({ ok: true, service: "chat" }));

// /history/:productId?before=<iso>&limit=50
app.get("/history/:productId", async (req, res) => {
  try {
    const productId = safeProductId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid productId" });
    }

    const before = req.query.before ? new Date(req.query.before).getTime() : Infinity;
    const limit = clamp(Number(req.query.limit) || HISTORY_PAGE_SIZE, 1, 200);

    const all = await loadRoom(productId);
    const filtered = all
      .filter((m) => new Date(m.createdAt).getTime() < before)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .reverse(); // ส่งเรียงเก่า -> ใหม่

    res.json({ success: true, productId, messages: filtered });
  } catch (e) {
    console.error("GET /history error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===== Socket.IO =====
const io = new Server(server, {
  cors: {
    origin: FRONT_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Auth ด้วย JWT ก่อนเชื่อมต่อ
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Missing token"));

    const check = await CheckAvalableToken(token);
    if (!check?.valid) return next(new Error("Invalid token"));

    socket.user = {
      email: (check?.decoded?.Email || check?.decoded?.email || "").toLowerCase(),
      id: check?.decoded?.ID || check?.decoded?.id || null,
      role: check?.decoded?.Role || check?.decoded?.role || "user",
    };
    return next();
  } catch (e) {
    return next(new Error("Auth failed"));
  }
});

// simple anti-spam per socket
const MSG_MIN_INTERVAL_MS = 500; // อย่างน้อย 0.5s ต่อข้อความ
const MSG_MAX_PER_MIN = 60;

io.on("connection", (socket) => {
  // สถานะป้องกันสแปม
  socket._lastMsgAt = 0;
  socket._windowCount = 0;
  socket._windowStart = Date.now();

  function canSend() {
    const now = Date.now();
    if (now - socket._lastMsgAt < MSG_MIN_INTERVAL_MS) return false;
    if (now - socket._windowStart > 60 * 1000) {
      socket._windowStart = now;
      socket._windowCount = 0;
    }
    if (socket._windowCount >= MSG_MAX_PER_MIN) return false;
    socket._lastMsgAt = now;
    socket._windowCount += 1;
    return true;
  }

  socket.on("join", async ({ productId }) => {
    try {
      const pid = safeProductId(productId);
      if (!pid) {
        return socket.emit("chat:error", { message: "Invalid productId" });
      }
      const room = roomName(pid);
      socket.join(room);

      // ส่งประวัติล่าสุดให้ client
      const all = await loadRoom(pid);
      const last = all.slice(-HISTORY_PAGE_SIZE);
      socket.emit("chat:history", { productId: pid, messages: last });

      // แจ้งคนอื่นในห้องว่ามีคนเข้ามา (optional)
      socket.to(room).emit("chat:presence", {
        productId: pid,
        type: "join",
        user: { email: socket.user.email },
        at: nowISO(),
      });
    } catch (e) {
      console.error("join error:", e);
      socket.emit("chat:error", { message: "Join failed" });
    }
  });

  socket.on("message", async ({ productId, text, clientId }) => {
    try {
      const pid = safeProductId(productId);
      if (!pid) return socket.emit("chat:error", { message: "Invalid productId" });

      const body = sanitizeText(text);
      if (!body) return; // ข้อความว่าง/ไม่ถูกต้อง ไม่ต้องทำอะไร

      if (!canSend()) {
        return socket.emit("chat:error", { message: "Slow down" });
      }

      const msg = {
        id: makeId(),
        clientId: clientId || null, // ให้ client map ack ได้
        productId: pid,
        sender: { email: socket.user.email },
        text: body,
        createdAt: nowISO(),
        readBy: [socket.user.email],
      };

      const all = await loadRoom(pid);
      all.push(msg);
      await saveRoomQueued(pid, all);

      const room = roomName(pid);
      io.to(room).emit("chat:new_message", msg);
    } catch (e) {
      console.error("message error:", e);
      socket.emit("chat:error", { message: "Message failed" });
    }
  });

  socket.on("typing", ({ productId, isTyping }) => {
    const pid = safeProductId(productId);
    if (!pid) return;
    const room = roomName(pid);
    socket.to(room).emit("chat:typing", {
      productId: pid,
      user: { email: socket.user.email },
      isTyping: !!isTyping,
    });
  });

  socket.on("read", async ({ productId, messageIds = [] }) => {
    try {
      const pid = safeProductId(productId);
      if (!pid || !Array.isArray(messageIds) || messageIds.length === 0) return;

      const all = await loadRoom(pid);
      let changed = false;
      for (const m of all) {
        if (messageIds.includes(m.id)) {
          m.readBy = Array.isArray(m.readBy) ? m.readBy : [];
          if (!m.readBy.includes(socket.user.email)) {
            m.readBy.push(socket.user.email);
            changed = true;
          }
        }
      }
      if (changed) await saveRoomQueued(pid, all);

      const room = roomName(pid);
      socket.to(room).emit("chat:read", {
        productId: pid,
        reader: socket.user.email,
        messageIds,
        at: nowISO(),
      });
    } catch (e) {
      console.error("read error:", e);
    }
  });

  socket.on("disconnect", () => {
    // optional: track presence
  });
});

// ===== Start =====
server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
