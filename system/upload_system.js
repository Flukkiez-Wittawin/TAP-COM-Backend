const multer = require("multer");
const path = require("path");
const fs = require(`fs`).promises;
const { imagesFilePath } = require(`./Path/PathAll`);
const { getCurrentDate } = require(`./Date/date_system`);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "Uploads/Images/");
  },
  filename: function (req, file, cb) {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const fileFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;

  if (allowedTypes.test(ext) && allowedTypes.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

const PictureScale = 10;
const Upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: PictureScale * 1024 * 1024 }, // 5MB
});

const UploadToDatabase = async (link, email) => {
  try {
    const data = await fs.readFile(imagesFilePath, "utf-8");
    const ImagesData = JSON.parse(data);

    const newImage = {
      link: link,
      date: await getCurrentDate(),
      email: email
    };

    console.log(newImage)

    ImagesData.push(newImage);

    await fs.writeFile(
      imagesFilePath,
      JSON.stringify(ImagesData, null, 2),
      "utf-8"
    );

    return {
      success: true,
      message: `Add ${link} to Image Path from ${email}`,
      data: ImagesData,
    };
  } catch (err) {
    console.error(err);
    return { success: false, message: "Failed to add log." };
  }
};

const ShowImages = async () => {}


module.exports = { Upload, UploadToDatabase };
