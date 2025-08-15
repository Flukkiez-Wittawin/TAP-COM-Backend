// backend/system/Sender/EmailSender_system.js

require("dotenv").config();
const nodemailer = require("nodemailer");

const MainEmail = process.env.GMAIL_USER;
const MainPass  = process.env.GMAIL_PASS;

if (!MainEmail || !MainPass) {
  throw new Error("Missing GMAIL_USER or GMAIL_PASS in .env");
}

// === Transporter (Gmail SMTP) ===
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,          // ถ้าติดปัญหา ลองเปลี่ยนเป็น 587 และ secure:false
  secure: true,
  auth: { user: MainEmail, pass: MainPass },
});

// ตรวจสุขภาพ SMTP ตอนสตาร์ท
transporter.verify((err) => {
  if (err) console.error("SMTP verify failed:", err);
  else console.log("SMTP ready");
});

// === Templates ===
const PROFILE_URL =
  "https://img2.pic.in.th/pic/ChatGPT_Image_10_.._2568_21_05_01-removebg-preview.png";

const SUBJECTS = {
  register: "ยินดีต้อนรับเข้าสู่ TAP.COM",
  GotIt: "แจ้งเตือน TAP.COM",
  CanSell: "แจ้งเตือน TAP.COM",
  OutBid: "แจ้งเตือน TAP.COM",
  AuctionLost: "แจ้งเตือน TAP.COM",
  // ใหม่สำหรับ Forgot Password
  forgot_code: "รหัสยืนยันรีเซ็ตรหัสผ่าน (OTP) • TAP.COM",
  forgot_reset_success: "เปลี่ยนรหัสผ่านสำเร็จ • TAP.COM",
  default: "แจ้งเตือน TAP.COM",
};

// ฟังก์ชันกรอบอีเมลกลาง (layout)
function wrapLayout(innerHtml) {
  return `
    <div style="background:#f6f7fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #eee;">
        <div style="text-align:center;padding:24px 24px 8px;">
          <img src="${PROFILE_URL}" alt="TAP.COM" style="max-width:96px;width:96px;height:auto;border-radius:50%;border:1px solid #e6e6e6;" />
          <div style="font-size:12px;color:#8a8a8a;margin-top:10px;">TAP.COM • Auction Platform</div>
        </div>
        <div style="padding:16px 24px 24px;color:#111;font-size:14px;line-height:1.6;">
          ${innerHtml}
        </div>
        <div style="padding:12px 24px 20px;color:#8a8a8a;font-size:12px;text-align:center;border-top:1px solid #f0f0f0">
          © ${new Date().getFullYear()} TAP.COM — This is an automated message.
        </div>
      </div>
    </div>
  `;
}

// เนื้อหาหลักตามประเภทข้อความ (รองรับ payload เช่น { code, ttlMinutes })
function bodyByType(type, payload = {}) {
  switch (type) {
    case "register":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">ยินดีต้อนรับเข้าสู่ TAP.COM</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#444;">ประมูลง่ายๆ แค่ 4 ขั้นตอน</p>
        <img src="https://img5.pic.in.th/file/secure-sv1/85d01bb007d373a5f7225980d002ed4c.jpg" 
             alt="TAP.COM Banner"
             style="max-width:100%;border-radius:8px;margin:12px 0;" />
        <ol style="padding-left:18px;color:#444;font-size:14px;line-height:1.6;margin:0;">
          <li>สมัครสมาชิก</li>
          <li>ยืนยันตัวตน</li>
          <li>เลือกสินค้าที่สนใจ</li>
          <li>ชนะและชำระเงิน</li>
        </ol>
      `;
    case "GotIt":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">แจ้งเตือน TAP.COM</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#444;">คุณเป็นผู้ชนะการประมูล 🎉</p>
        <p style="margin:0;font-size:14px;color:#444;">กรุณาเข้าสู่ระบบเพื่อดำเนินการชำระเงินภายในเวลาที่กำหนด</p>
      `;
    case "CanSell":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">แจ้งเตือน TAP.COM</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#444;">การประมูลของคุณเสร็จสิ้น</p>
        <p style="margin:0;font-size:14px;color:#444;">เมื่อลูกค้าโอนเงินแล้วจะแจ้งให้ทราบ</p>
      `;
    case "OutBid":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">แจ้งเตือน TAP.COM</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#444;">ตอนนี้มีคนประมูลแซงหน้าคุณแล้วนะ 🚨</p>
        <p style="margin:0;font-size:14px;color:#444;">กลับเข้าสู่ระบบเพื่อทำการประมูลต่อไป เพื่อที่จะเป็นที่ 1</p>
      `;
    case "AuctionLost":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">แจ้งเตือน TAP.COM</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#444;">การประมูลได้จบลงแล้ว</p>
        <p style="margin:0;font-size:14px;color:#444;">เสียใจด้วย หวังว่าครั้งหน้าจที่ 1 จะเป็นของคุณ 🥺</p>
      `;
    // ===== ใหม่: Forgot Password - ส่งโค้ด OTP =====
    case "forgot_code": {
      const code = payload.code || "------";
      const ttl  = payload.ttlMinutes ?? 10;
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">ยืนยันรีเซ็ตรหัสผ่าน</h1>
        <p style="margin:0 0 8px;font-size:14px;color:#444;">นี่คือรหัสยืนยัน (OTP) สำหรับการรีเซ็ตรหัสผ่านของคุณ</p>
        <div style="margin:12px 0 16px;font-size:28px;font-weight:700;letter-spacing:3px;color:#0d6efd;">
          ${code}
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#666;">รหัสมีอายุ <strong>${ttl} นาที</strong> กรุณาอย่าเปิดเผยรหัสนี้ให้ผู้อื่น</p>
        <p style="margin:0;font-size:13px;color:#666;">หากคุณไม่ได้ร้องขอการรีเซ็ตรหัสผ่าน โปรดเพิกเฉยอีเมลฉบับนี้</p>
      `;
    }
    // ===== ใหม่: Forgot Password - แจ้งรีเซ็ตสำเร็จ =====
    case "forgot_reset_success":
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">เปลี่ยนรหัสผ่านสำเร็จ</h1>
        <p style="margin:0 0 8px;font-size:14px;color:#444;">เราได้อัปเดตรหัสผ่านบัญชีของคุณเรียบร้อยแล้ว</p>
        <p style="margin:0;font-size:13px;color:#666;">หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเปลี่ยนรหัสผ่านทันทีและติดต่อฝ่ายสนับสนุน</p>
      `;
    default:
      return `
        <h1 style="margin:0 0 8px;font-size:22px;color:#111;">แจ้งเตือน TAP.COM</h1>
        <p style="margin:0;font-size:14px;color:#444;">ไม่มีข้อความสำหรับประเภทนี้</p>
      `;
  }
}

// helper: สำรอง text/plain (บางเมลไม่เปิด HTML)
function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
}

// === Main Sender ===
// เพิ่มพารามิเตอร์ payload สำหรับกรณีที่ต้องใส่ข้อมูลลงเทมเพลต (เช่น code, ttlMinutes)
async function SendMailer_Auto(email, messageType, payload = {}) {
  try {
    const inner = bodyByType(messageType, payload);
    const html  = wrapLayout(inner);

    const info = await transporter.sendMail({
      from: { name: "TAP.COM", address: MainEmail },
      to: email, // รับ array ได้: ['a@x.com','b@y.com']
      subject: SUBJECTS[messageType] || SUBJECTS.default,
      html,
      text: stripHtml(html),
      replyTo: MainEmail,
      headers: { "X-App": "TAP.COM" },
    });

    console.log("Email sent:", info.messageId || info.response);
    return { success: true, message: "Send Success", messageId: info.messageId || null };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, message: error.message };
  }
}

async function SendMailer_Manual(email, subject, messageHtmlOrText) {
  try {
    const html = wrapLayout(messageHtmlOrText || "");
    const info = await transporter.sendMail({
      from: { name: "TAP.COM", address: MainEmail },
      to: email,
      subject,
      html,
      text: stripHtml(messageHtmlOrText || ""),
      replyTo: MainEmail,
      headers: { "X-App": "TAP.COM" },
    });
    console.log("Email sent:", info.messageId || info.response);
    return { success: true, message: "Send Success", messageId: info.messageId || null };
  } catch (err) {
    console.error("Error sending email:", err);
    return { success: false, message: err.message };
  }
}

module.exports = { SendMailer_Auto, SendMailer_Manual };
