const fsp = require("fs").promises;
const { userFilePath } = require("../Path/PathAll");
const { getCurrentDateISO } = require("../Date/date_system");

const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

async function readUsers() {
  try {
    const txt = await fsp.readFile(userFilePath, "utf8");
    const data = JSON.parse(txt || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function writeUsers(users) {
  await fsp.writeFile(userFilePath, JSON.stringify(users, null, 2), "utf8");
}

function coerceId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : String(id);
}

async function AddDataToCurrentWin(email, id) {
  const e = normalizeEmail(email);
  const users = await readUsers();

  const idx = users.findIndex((u) => normalizeEmail(u?.Email) === e);
  if (idx === -1) throw new Error(`USER_NOT_FOUND: ${email}`);

  const user = users[idx];
  if (!Array.isArray(user.CurrentWin)) user.CurrentWin = [];

  const winId = coerceId(id);
  const exists = user.CurrentWin.some((w) => String(w?.win) === String(winId));

  if (!exists) {
    user.CurrentWin.push({
      win: winId,
      date: await getCurrentDateISO(),
    });
  }

  users[idx] = user;
  await writeUsers(users);

  return {
    email: user.Email,
    win: user.Score?.Win ?? 0,
    currentWinCount: user.CurrentWin.length,
    added: !exists,
  };
}

module.exports = { AddDataToCurrentWin };
