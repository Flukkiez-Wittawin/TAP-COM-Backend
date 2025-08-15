// ForgotPassword.js
const fs = require("fs").promises;
const bcrypt = require("bcrypt");
const { userFilePath } = require("./Path/PathAll");
const { AddDataToLog } = require("./logs_system");
const { SendMailer_Auto } = require("./Sender/EmailSender_system");

// ===== Config =====
const RESET_CODE_LENGTH = 6;          // จำนวนหลัก OTP
const RESET_CODE_TTL_MINUTES = 10;    // อายุโค้ด (นาที)
const RESET_MAX_ATTEMPTS = 5;         // จำนวนครั้งยืนยันสูงสุด

// ===== Helpers =====
function generateResetCode(len = RESET_CODE_LENGTH) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

async function loadUsers() {
  try {
    const raw = await fs.readFile(userFilePath, "utf-8");
    const users = JSON.parse(raw || "[]");
    return Array.isArray(users) ? users : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function saveUsers(users) {
  await fs.writeFile(userFilePath, JSON.stringify(users, null, 2), "utf-8");
}

const isStrongPassword = (password) =>
  /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>_])[A-Za-z\d!@#$%^&*(),.?":{}|<>_]{8,}$/.test(password);

// ===== Core Flows =====

/**
 * Step 1: ขอรหัสรีเซ็ต
 * สร้าง users[idx].PasswordReset = { code, expiresAt, attempts, verified }
 */
async function RequestPasswordReset(email) {
  try {
    const users = await loadUsers();
    const idx = users.findIndex(
      (u) => String(u?.Email).toLowerCase() === String(email).toLowerCase()
    );

    // เพื่อความปลอดภัย สามารถเปลี่ยนเป็น success เสมอได้ (comment ด้านล่าง)
    if (idx === -1) {
      // return { success: true, message: "If the email exists, a reset code has been sent." };
      return { success: false, message: "Email not found" };
    }

    const code = generateResetCode();
    const expiresAt = addMinutes(new Date(), RESET_CODE_TTL_MINUTES).toISOString();

    users[idx].PasswordReset = {
      code,
      expiresAt,
      attempts: 0,
      verified: false,
    };

    await saveUsers(users);

    try {
      // ปรับให้เข้ากับลายเซ็นฟังก์ชันส่งเมลของคุณ
      // ตัวอย่าง: ส่งประเภท "forgot_code" พร้อม code
      await SendMailer_Auto(email, "forgot_code", { code });
    } catch (e) {
      console.error("Send mail failed:", e);
    }

    AddDataToLog(`RequestPasswordReset: ส่งโค้ดให้ ${email}`);
    return { success: true, message: "Reset code sent" };
  } catch (err) {
    console.error("RequestPasswordReset error:", err);
    return { success: false, message: "Failed to request password reset" };
  }
}

/**
 * Step 2: ยืนยันโค้ด
 */
async function VerifyPasswordResetCode(email, code) {
  try {
    const users = await loadUsers();
    const idx = users.findIndex(
      (u) => String(u?.Email).toLowerCase() === String(email).toLowerCase()
    );
    if (idx === -1) return { success: false, message: "Email not found" };

    const pr = users[idx].PasswordReset;
    if (!pr) return { success: false, message: "No reset request" };

    // หมดอายุ?
    if (new Date(pr.expiresAt).getTime() < Date.now()) {
      return { success: false, message: "Code expired" };
    }

    // เกินจำนวนครั้ง?
    if ((pr.attempts || 0) >= RESET_MAX_ATTEMPTS) {
      return { success: false, message: "Too many attempts" };
    }

    // เพิ่ม attempts ก่อนเช็ค (ลด brute force)
    pr.attempts = (pr.attempts || 0) + 1;

    if (String(code) !== String(pr.code)) {
      users[idx].PasswordReset = pr;
      await saveUsers(users);
      return { success: false, message: "Invalid code" };
    }

    // โค้ดถูกต้อง
    pr.verified = true;
    users[idx].PasswordReset = pr;
    await saveUsers(users);

    AddDataToLog(`VerifyPasswordResetCode: ${email} verified`);
    return { success: true, message: "Code verified" };
  } catch (err) {
    console.error("VerifyPasswordResetCode error:", err);
    return { success: false, message: "Failed to verify code" };
  }
}

/**
 * Step 3: ตั้งรหัสผ่านใหม่
 */
async function ResetPasswordWithCode(email, code, newPassword) {
  try {
    if (!isStrongPassword(newPassword)) {
      return {
        success: false,
        message:
          "Password must be at least 8 characters long and include at least one uppercase letter and one special character.",
      };
    }

    const users = await loadUsers();
    const idx = users.findIndex(
      (u) => String(u?.Email).toLowerCase() === String(email).toLowerCase()
    );
    if (idx === -1) return { success: false, message: "Email not found" };

    const pr = users[idx].PasswordReset;
    if (!pr) return { success: false, message: "No reset request" };

    // ต้อง verified แล้ว และโค้ดตรง + ไม่หมดอายุ
    if (!pr.verified || String(code) !== String(pr.code)) {
      return { success: false, message: "Code not verified" };
    }
    if (new Date(pr.expiresAt).getTime() < Date.now()) {
      return { success: false, message: "Code expired" };
    }

    // ตั้งรหัสผ่านใหม่
    const hashed = await bcrypt.hash(newPassword, 10);
    users[idx].Password = hashed;

    // ล้างสถานะรีเซ็ต
    delete users[idx].PasswordReset;

    await saveUsers(users);

    try {
      await SendMailer_Auto(email, "forgot_reset_success");
    } catch (e) {
      console.error("Send mail failed:", e);
    }

    AddDataToLog(`ResetPassword: ${email} changed password`);
    return { success: true, message: "Password reset successful" };
  } catch (err) {
    console.error("ResetPasswordWithCode error:", err);
    return { success: false, message: "Failed to reset password" };
  }
}

module.exports = {
  RequestPasswordReset,
  VerifyPasswordResetCode,
  ResetPasswordWithCode,
};
