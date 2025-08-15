// chat_server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs").promises;
const path = require("path");

// ---- ใช้ตัวตรวจ JWT เดิมของคุณ ----
const { CheckAvalableToken } = require("./system/jwt_token");

// ตั้งค่า
const PORT = Number(process.env.PORT_CHAT || 3002);
const FRONT_ORIGIN = process.env.FRONT_ORIGIN || "http://localhost:5173";

const CHATS_DIR = path.join(__dirname, "Chats");
const HISTORY_PAGE_SIZE = 50;

// สร้างโฟลเดอร์เก็บแชท
(async () => {
  await fs.mkdir(CHATS_DIR, { recursive: true });
})().catch(console.error);

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(cors({
  origin: FRONT_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));


// -------- Utilities --------
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

async function saveRoom(productId, messages) {
  const f = fileForRoom(productId);
  await fs.writeFile(f, JSON.stringify(messages, null, 2), "utf-8");
}

function nowISO() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// -------- REST เล็กน้อยสำหรับดึงประวัติ (ออปชัน) --------
app.get("/health", (_req, res) => res.json({ ok: true, service: "chat" }));

// /history/:productId?before=<iso>&limit=50
app.get("/history/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const before = req.query.before ? new Date(req.query.before).getTime() : Infinity;
    const limit = Math.max(1, Math.min(Number(req.query.limit) || HISTORY_PAGE_SIZE, 200));

    const all = await loadRoom(productId);
    const filtered = all
      .filter((m) => new Date(m.createdAt).getTime() < before)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .reverse(); // ส่งเรียงเก่า->ใหม่

    res.json({ success: true, productId, messages: filtered });
  } catch (e) {
    console.error("GET /history error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------- Socket.IO --------
const io = new Server(server, {
  cors: {
    origin: FRONT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

io.use(async (socket, next) => {
  try {
    // token มาทาง query ?token=... หรือ ส่งภายหลังด้วย event 'auth'
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Missing token"));
    const check = await CheckAvalableToken(token);
    if (!check?.valid) return next(new Error("Invalid token"));
    // แนบข้อมูล user ไว้กับ socket
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
      if (!productId) return;
      const room = roomName(productId);
      socket.join(room);

      // ส่งประวัติล่าสุดให้ client
      const all = await loadRoom(productId);
      const last = all.slice(-HISTORY_PAGE_SIZE);
      socket.emit("chat:history", { productId, messages: last });

      // แจ้งคนอื่นในห้องว่ามีคนเข้ามา (optional)
      socket.to(room).emit("chat:presence", {
        productId,
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
      if (!productId || !text || typeof text !== "string") return;
      if (!canSend()) {
        return socket.emit("chat:error", { message: "Slow down" });
      }
      const msg = {
        id: makeId(),
        clientId: clientId || null, // ไว้ให้ client map ack ได้
        productId: String(productId),
        sender: { email: socket.user.email },
        text: text.slice(0, 2000),
        createdAt: nowISO(),
        readBy: [socket.user.email],
      };

      const all = await loadRoom(productId);
      all.push(msg);
      await saveRoom(productId, all);

      const room = roomName(productId);
      io.to(room).emit("chat:new_message", msg);
    } catch (e) {
      console.error("message error:", e);
      socket.emit("chat:error", { message: "Message failed" });
    }
  });

  socket.on("typing", ({ productId, isTyping }) => {
    if (!productId) return;
    const room = roomName(productId);
    socket.to(room).emit("chat:typing", {
      productId,
      user: { email: socket.user.email },
      isTyping: !!isTyping,
    });
  });

  socket.on("read", async ({ productId, messageIds = [] }) => {
    try {
      if (!productId || !Array.isArray(messageIds) || messageIds.length === 0) return;
      const all = await loadRoom(productId);
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
      if (changed) await saveRoom(productId, all);
      const room = roomName(productId);
      socket.to(room).emit("chat:read", {
        productId,
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

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
