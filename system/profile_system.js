// backend/system/profile_update.js
const fs = require("fs").promises;
const path = require("path");
const { GenerateToken } = require(`./jwt_token`);

const userFilePath = path.join(__dirname, "..", "database", "users.json");

const normalize = (v) => String(v ?? "").trim().toLowerCase();

async function readUsers() {
  try {
    const raw = await fs.readFile(userFilePath, "utf8");
    const data = JSON.parse(raw || "[]");
    // รองรับทั้ง Array และ Object (เช่น {"1": {...}, "2": {...}})
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return Object.values(data);
    return [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function writeUsers(users) {
  await fs.mkdir(path.dirname(userFilePath), { recursive: true });
  await fs.writeFile(userFilePath, JSON.stringify(users, null, 2), "utf8");
}

function ensureUserShape(u = {}) {
  return {
    ID: u.ID || u.id || "",
    Email: u.Email || u.email || "",
    Role: u.Role || u.role || "user",
    Personal: {
      FirstName: u?.Personal?.FirstName || u?.firstName || "",
      LastName: u?.Personal?.LastName || u?.lastName || "",
      BirthDay: u?.Personal?.BirthDay || u?.birthDay || "",
      Profile: u?.Personal?.Profile || u?.profile || "",
      AlreadyCheck: !!(u?.Personal?.AlreadyCheck ?? u?.alreadyCheck),
      IsOnBlacklist: !!(u?.Personal?.IsOnBlacklist ?? u?.isOnBlacklist),
      Country: u?.Personal?.Country || u?.country || "",
      PhoneNumber: u?.Personal?.PhoneNumber || u?.phoneNumber || "",
      Address: u?.Personal?.Address || u?.address || "",
      Line: u?.Personal?.Line || u?.line || "",
      Facebook: u?.Personal?.Facebook || u?.facebook || "",
      Instagram: u?.Personal?.Instagram || u?.instagram || "",
      Twitter: u?.Personal?.Twitter || u?.twitter || "",
      Youtube: u?.Personal?.Youtube || u?.youtube || "",
      Tiktok: u?.Personal?.Tiktok || u?.tiktok || "",
    },
    Score: u.Score || { Win: 0, Lose: 0, DontGet: 0 },
    Login: u.Login || { CurrentSession: 0, Hwid: "", CurrentLocation: "" },
    CheckUser: u.CheckUser || { MainCard: "", CardWithFace: "" },
    CurrentWin: Array.isArray(u.CurrentWin) ? u.CurrentWin : [],
  };
}

// ดึง email/id จาก user โดยเผื่อหลายคีย์
function getUserId(u) {
  return String(u.ID ?? u.id ?? "").trim();
}
function getUserEmail(u) {
  return String(u.Email ?? u.email ?? "").trim();
}

/**
 * where: { id, email }
 * payload: ฟิลด์ใน Personal ที่จะอัปเดต (camelCase)
 * extra: { profileUrl }
 */
async function UpdateProfile(where = {}, payload = {}, extra = {}) {
  const usersRaw = await readUsers();
  // map ให้เป็นทรงเดียวกันก่อน
  const users = usersRaw.map(ensureUserShape);

  const wantId = String(where.id ?? "").trim();
  const wantEmail = normalize(where.email);

  const idx = users.findIndex((u) => {
    const uid = String(getUserId(u));
    const uemail = normalize(getUserEmail(u));
    return (wantId && String(uid) === String(wantId)) ||
           (wantEmail && uemail === wantEmail);
  });

  if (idx === -1) {
    // log ช่วยดีบักให้รู้ว่าในไฟล์มีค่าอะไรบ้าง
    // (ถ้าไม่อยาก log ก็ลบทิ้งได้)
    console.warn("[UpdateProfile] user not found. where=", where, 
      "existingEmails=", users.map(getUserEmail));
    return { success: false, message: "User not found" };
  }

  const oldUser = users[idx];

  const p = {
    ...oldUser.Personal,
    FirstName: payload.firstName ?? oldUser.Personal.FirstName,
    LastName: payload.lastName ?? oldUser.Personal.LastName,
    BirthDay: payload.birthDay ?? oldUser.Personal.BirthDay,
    Country: payload.country ?? oldUser.Personal.Country,
    PhoneNumber: payload.phoneNumber ?? oldUser.Personal.PhoneNumber,
    Address: payload.address ?? oldUser.Personal.Address,
    Line: payload.line ?? oldUser.Personal.Line,
    Facebook: payload.facebook ?? oldUser.Personal.Facebook,
    Instagram: payload.instagram ?? oldUser.Personal.Instagram,
    Twitter: payload.twitter ?? oldUser.Personal.Twitter,
    Youtube: payload.youtube ?? oldUser.Personal.Youtube,
    Tiktok: payload.tiktok ?? oldUser.Personal.Tiktok,
    Profile: extra.profileUrl ?? oldUser.Personal.Profile,
  };

  if (typeof payload.alreadyCheck !== "undefined") {
    p.AlreadyCheck = payload.alreadyCheck === true || payload.alreadyCheck === "true";
  }
  if (typeof payload.isOnBlacklist !== "undefined") {
    p.IsOnBlacklist = payload.isOnBlacklist === true || payload.isOnBlacklist === "true";
  }

  const newUser = { ...oldUser, Personal: p };
  users[idx] = newUser;

  // เขียนกลับ (ยังเป็น array) — ถ้าไฟล์คุณเดิมเป็น object mapping id->user
  // ให้คุณแปลงกลับเองก่อน writeUsers หรือตั้งใจ migrate มาเป็น array ให้จบ
  await writeUsers(users);

  return {
    success: true,
    message: "Profile updated",
    token: await GenerateToken(newUser),
    user: newUser,
  };
}

module.exports = { UpdateProfile };
