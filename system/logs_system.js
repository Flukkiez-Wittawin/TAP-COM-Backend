const fs = require('fs').promises;
const path = require('path');
const { logsHistoryFilePath } = require('./Path/PathAll');
const { getCurrentDateISO } = require('./Date/date_system');

async function AddDataToLog(message) {
  try {
    // สร้างโฟลเดอร์ถ้ายังไม่มี
    await fs.mkdir(path.dirname(logsHistoryFilePath), { recursive: true });

    // อ่านไฟล์ ถ้าไม่เจอให้เริ่มเป็น array ว่าง
    let raw = '[]';
    try {
      raw = await fs.readFile(logsHistoryFilePath, 'utf-8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // ถ้าเป็น error อื่นค่อยโยนต่อ
    }

    // แปลงเป็น array ถ้าเสียให้เริ่มใหม่
    let logs = [];
    try {
      const parsed = JSON.parse(raw);
      logs = Array.isArray(parsed) ? parsed : [];
    } catch {
      logs = [];
    }

    const newLog = {
      id: (logs.at(-1)?.id ?? 0) + 1,   // ต่อ id จากตัวสุดท้าย
      message,
      date: await getCurrentDateISO(),  // ถ้า getCurrentDateISO เป็น sync ก็เอา await ออก
    };

    logs.push(newLog);

    await fs.writeFile(
      logsHistoryFilePath,
      JSON.stringify(logs, null, 2),
      'utf-8'
    );

    return {
      success: true,
      message: 'Log added successfully.',
      data: logs,
    };
  } catch (err) {
    console.error(err);
    return { success: false, message: 'Failed to add log.' };
  }
}

module.exports = { AddDataToLog };
