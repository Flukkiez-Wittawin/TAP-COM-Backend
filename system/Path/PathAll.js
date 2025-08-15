const path = require("path");

const DirectionPath = `../../`;
const userFilePath = path.join(
  __dirname,
  DirectionPath,
  "Database",
  "Users.json"
);

const productsFilePath = path.join(
  __dirname,
  DirectionPath,
  "Database",
  "Products.json"
);

const imagesFilePath = path.join(
  __dirname,
  DirectionPath,
  "Database",
  "Images.json"
);

const logsHistoryFilePath = path.join(
  __dirname,
  DirectionPath,
  "Database",
  "Logs.json"
);

module.exports = {
  userFilePath,
  productsFilePath,
  imagesFilePath,
  logsHistoryFilePath,
};
