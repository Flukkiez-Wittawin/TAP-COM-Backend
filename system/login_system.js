const fs = require("fs").promises;
const path = require("path");
const bcrypt = require("bcrypt");
const { userFilePath } = require("./Path/PathAll");
const { getCountryCodeFromIP } = require(`./GetData/IP-Path`);
const { getCurrentDate } = require(`./Date/date_system`);
const { AddDataToLog } = require(`./logs_system`);
const { SendMailer_Auto } = require("./Sender/EmailSender_system");

const VerifyPassword = async (plainPassword, hashedPassword) => {
  if (!plainPassword || !hashedPassword) {
    console.error("Missing password inputs to bcrypt.compare");
    return false;
  }
  return await bcrypt.compare(plainPassword, hashedPassword);
};

async function CheckUsers(email) {
  const data = await fs.readFile(userFilePath, "utf-8");
  const users = JSON.parse(data);
  const user = users.find((user) => user.Email === email);
  if (!user) return null;

  return {
    ...user,
    hashedPassword: user.Password,
  };
}

function isStrongPassword(password) {
  // ต้องมีอย่างน้อย 8 ตัวอักษร, ตัวพิมพ์ใหญ่ 1 ตัว, ตัวอักษรพิเศษอย่างน้อย 1 ตัว (รวม _ ด้วย)
  const strongPasswordRegex =
    /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>_])[A-Za-z\d!@#$%^&*(),.?":{}|<>_]{8,}$/;
  return strongPasswordRegex.test(password);
}

async function Register(email, password, FirstName, LastName, ip) {
  try {
    // ตรวจสอบความแข็งแกร่งของรหัสผ่าน
    if (!isStrongPassword(password)) {
      return {
        success: false,
        message:
          "Password must be at least 8 characters long and include at least one uppercase letter and one special character.",
      };
    }

    const exists = await CheckUsers(email);
    if (exists) {
      return { success: false, message: "Email already registered" };
    }

    const IP = await getCountryCodeFromIP(ip);
    if (IP == "Unknown") return { success: false, message: "IP NOT FOUND" };

    const data = await fs.readFile(userFilePath, "utf-8");
    const users = JSON.parse(data);

    const hashedPassword = await bcrypt.hash(password, 10);
    const newCurrentID = `TAP.ID-${users.length + 1}`;
    const newUser = {
      ID: newCurrentID,
      Email: email,
      Password: hashedPassword,
      onRegister: getCurrentDate(),
      Personal: {
        FirstName: FirstName,
        LastName: LastName,
        BirthDay: "",
        Profile: "",
        AlreadyCheck: false,
        IsOnBlacklist: false,
        Country: IP,
        PhoneNumber: "",
        Line: "",
        Facebook: "",
        Instagram: "",
        Twitter: "",
        Youtube: "",
        Tiktok: "",
        Address: "",
      },
      Score: {
        Win: 0,
        Lose: 0,
        DontGet: 0,
      },
      CheckUser: {
        MainCard: "",
        CardWithFace: "",
      },
      CurrentWin: [],
      Role: "user",
    };

    users.push(newUser);
    AddDataToLog(`${newCurrentID} ได้สมัครด้วย Email : ${email}`);
    SendMailer_Auto(email, `register`)

    await fs.writeFile(userFilePath, JSON.stringify(users, null, 2), "utf-8");

    return { success: true, message: "Registration successful", user: newUser };
  } catch (err) {
    console.error("Register error:", err);
    return { success: false, message: "Registration failed" };
  }
}

module.exports = { CheckUsers, Register, VerifyPassword };
