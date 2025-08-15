// system/manage_user_system.js
const fsp = require('fs').promises;
const { userFilePath } = require('./Path/PathAll');

const normalizeEmail = e => String(e || '').trim().toLowerCase();

async function readUsers() {
  try {
    const txt = await fsp.readFile(userFilePath, 'utf8');
    const data = JSON.parse(txt || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeUsers(users) {
  await fsp.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf8');
}

async function GetUser(email) {
  const e = normalizeEmail(email);
  const users = await readUsers();
  return users.find(u => normalizeEmail(u?.Email) === e) || null;
}

async function IncrementUserWin(email) {
  const e = normalizeEmail(email);
  const users = await readUsers();
  const idx = users.findIndex(u => normalizeEmail(u?.Email) === e);
  if (idx === -1) throw new Error(`USER_NOT_FOUND: ${email}`);

  const user = users[idx];
  user.Score = user.Score || { Win: 0, Lose: 0, DontGet: 0 };
  user.Score.Win = Number(user.Score.Win || 0) + 1;

  users[idx] = user;
  await writeUsers(users);
  return { email: user.Email, win: user.Score.Win };
}

/** ✅ เพิ่ม: แพ้ +1 (เดี่ยว) */
async function IncrementUserLose(email) {
  const e = normalizeEmail(email);
  const users = await readUsers();
  const idx = users.findIndex(u => normalizeEmail(u?.Email) === e);
  if (idx === -1) throw new Error(`USER_NOT_FOUND: ${email}`);

  const user = users[idx];
  user.Score = user.Score || { Win: 0, Lose: 0, DontGet: 0 };
  user.Score.Lose = Number(user.Score.Lose || 0) + 1;

  users[idx] = user;
  await writeUsers(users);
  return { email: user.Email, lose: user.Score.Lose };
}

/** ✅ เพิ่ม: แพ้ +1 (เป็นชุด) — ใช้กับ CurrentEmail */
async function IncrementUsersLose(emails, opts = {}) {
  const exclude = new Set((opts.exclude || []).map(normalizeEmail));
  const users = await readUsers();
  const updated = [];

  for (const raw of emails || []) {
    const e = normalizeEmail(raw);
    if (!e || exclude.has(e)) continue;

    const idx = users.findIndex(u => normalizeEmail(u?.Email) === e);
    if (idx === -1) continue; // ไม่เจอ user ข้ามไป

    const user = users[idx];
    user.Score = user.Score || { Win: 0, Lose: 0, DontGet: 0 };
    user.Score.Lose = Number(user.Score.Lose || 0) + 1;

    users[idx] = user;
    updated.push({ email: user.Email, lose: user.Score.Lose });
  }

  if (updated.length) await writeUsers(users);
  return updated;
}

module.exports = {
  GetUser,
  IncrementUserWin,
  IncrementUserLose,     // ⬅️ export ใหม่
  IncrementUsersLose,    // ⬅️ export ใหม่
};
