// backend/system/profile_update.js
const fs = require("fs").promises;
const path = require("path");
const { GenerateToken } = require(`./jwt_token`);

const userFilePath = path.join(__dirname, "..", "database", "users.json");

async function readUsers() {
  try {
    const raw = await fs.readFile(userFilePath, "utf8");
    return JSON.parse(raw);
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
    ID: u.ID || "",
    Email: u.Email || "",
    Role: u.Role || "user",
    Personal: {
      FirstName: u?.Personal?.FirstName || "",
      LastName: u?.Personal?.LastName || "",
      BirthDay: u?.Personal?.BirthDay || "",
      Profile: u?.Personal?.Profile || "",
      AlreadyCheck: !!u?.Personal?.AlreadyCheck,
      IsOnBlacklist: !!u?.Personal?.IsOnBlacklist,
      Country: u?.Personal?.Country || "",
      PhoneNumber: u?.Personal?.PhoneNumber || "",
      Address: u?.Personal?.Address || "",
      Line: u?.Personal?.Line || "",
      Facebook: u?.Personal?.Facebook || "",
      Instagram: u?.Personal?.Instagram || "",
      Twitter: u?.Personal?.Twitter || "",
      Youtube: u?.Personal?.Youtube || "",
      Tiktok: u?.Personal?.Tiktok || "",
    },
    Score: u.Score || { Win: 0, Lose: 0, DontGet: 0 },
    Login: u.Login || { CurrentSession: 0, Hwid: "", CurrentLocation: "" },
    CheckUser: u.CheckUser || { MainCard: "", CardWithFace: "" },
    CurrentWin: Array.isArray(u.CurrentWin) ? u.CurrentWin : [],
  };
}

/**
 * where: { id, email }
 * payload: ฟิลด์ใน Personal ที่จะอัปเดต
 * extra: { profileUrl }
 */
async function UpdateProfile(where = {}, payload = {}, extra = {}) {
  const users = await readUsers();

  const idx = users.findIndex(
    (u) =>
      (where.id && String(u.ID) === String(where.id)) ||
      (where.email &&
        String(u.Email).toLowerCase() === String(where.email).toLowerCase())
  );
  if (idx === -1) return { success: false, message: "User not found" };

  const oldUser = users[idx]; // เก็บของเดิมไว้ทั้งก้อน
  const p = {
    ...oldUser.Personal, // merge ของเดิม
    FirstName: payload.firstName ?? oldUser.Personal?.FirstName ?? "",
    LastName: payload.lastName ?? oldUser.Personal?.LastName ?? "",
    BirthDay: payload.birthDay ?? oldUser.Personal?.BirthDay ?? "",
    Country: payload.country ?? oldUser.Personal?.Country ?? "",
    PhoneNumber: payload.phoneNumber ?? oldUser.Personal?.PhoneNumber ?? "",
    Address: payload.address ?? oldUser.Personal?.Address ?? "",
    Line: payload.line ?? oldUser.Personal?.Line ?? "",
    Facebook: payload.facebook ?? oldUser.Personal?.Facebook ?? "",
    Instagram: payload.instagram ?? oldUser.Personal?.Instagram ?? "",
    Twitter: payload.twitter ?? oldUser.Personal?.Twitter ?? "",
    Youtube: payload.youtube ?? oldUser.Personal?.Youtube ?? "",
    Tiktok: payload.tiktok ?? oldUser.Personal?.Tiktok ?? "",
    Profile: extra.profileUrl ?? oldUser.Personal?.Profile ?? "",
  };

  if (typeof payload.alreadyCheck !== "undefined") {
    p.AlreadyCheck = payload.alreadyCheck === true || payload.alreadyCheck === "true";
  }
  if (typeof payload.isOnBlacklist !== "undefined") {
    p.IsOnBlacklist = payload.isOnBlacklist === true || payload.isOnBlacklist === "true";
  }

  // เขียนกลับแบบกระทบเฉพาะ Personal
  const newUser = { ...oldUser, Personal: p };

  users[idx] = newUser;
  await writeUsers(users);

  return { success: true, message: "Profile updated", token: await GenerateToken(newUser), user: newUser };
}


module.exports = { UpdateProfile };
