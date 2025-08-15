async function getCurrentDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0"); // เดือนเริ่มที่ 0
  const year = String(now.getFullYear()).slice(-2); // เอาแค่ 2 หลักหลัง

  return `${day}/${month}/${year}`;
}

async function getCurrentDateISO() {
    const currentIso = new Date().toISOString().slice(0,19)
    return currentIso;
}

module.exports = { getCurrentDate, getCurrentDateISO };
