// backend/system/products_system.js
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { productsFilePath } = require("./Path/PathAll");

// อ่านไฟล์ products.json
async function readProducts() {
  try {
    if (!fsSync.existsSync(productsFilePath)) {
      await fs.mkdir(path.dirname(productsFilePath), { recursive: true });
      await fs.writeFile(productsFilePath, "[]", "utf-8");
    }
    const data = await fs.readFile(productsFilePath, "utf-8");
    return JSON.parse(data || "[]");
  } catch (e) {
    console.error("readProducts error:", e);
    return [];
  }
}

async function writeProducts(products) {
  await fs.writeFile(productsFilePath, JSON.stringify(products, null, 2), "utf-8");
}

async function GetProducts() {
  return await readProducts();
}

async function UpdateProductData(updatedProducts) {
  try {
    const dataToWrite = JSON.stringify(
      Array.isArray(updatedProducts)
        ? updatedProducts
        : Object.values(updatedProducts),
      null,
      2
    );
    await fs.writeFile(productsFilePath, dataToWrite, "utf-8");
    console.log("Products.json updated successfully.");
  } catch (error) {
    console.error("Failed to update Products.json:", error);
  }
}

async function LoadProductsData(products) {
  try {
    const dataFromFile = await readProducts();
    if (Array.isArray(dataFromFile)) {
      dataFromFile.forEach((p) => {
        const productId = String(p.id);
        products[productId] = { ...p };
      });
    } else {
      console.warn("Products data is not an array.");
    }
    console.log("products loaded:", Object.keys(products));
  } catch (err) {
    console.error("Error loading products:", err);
  }
}

// ✅ เพิ่ม meta พารามิเตอร์
async function UploadProductData(info, value, bit, max, name, type, allImages, meta = {}) {
  try {
    const productData = await readProducts();
    const nextId = productData.length ? Math.max(...productData.map(p => p.id || 0)) + 1 : 1;

    const newProduct = {
      id: nextId,
      info: info,
      value: Number(value),
      bit: Number(bit),
      UserClick: 0,
      max: Number(max),
      type: "waiting",
      aunction_owner: name,
      images: allImages,
      productType: type,
      // ✅ meta ที่ใช้ใน UI
      description: meta.description || "",
      category: meta.category || "",
      startedAt: meta.startedAt || null,
      endAt: meta.endAt || null,
      highestBidder: "",       // เก็บชื่อผู้บิดสูงสุดล่าสุด
      CurrentEmail : []
    };

    productData.push(newProduct);
    await writeProducts(productData);

    return { success: true, message: "Upload Product Successfully", data: newProduct };
  } catch (err) {
    console.error(err);
    return { success: false, message: "Upload Product Failed" };
  }
}

module.exports = {
  GetProducts,
  UpdateProductData,
  LoadProductsData,
  UploadProductData,
};
