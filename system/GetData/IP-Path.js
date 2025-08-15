const geoip = require("geoip-country");

async function getCountryCodeFromIP(ip) {
  const geo = geoip.lookup(ip);
  if (geo && geo.country) {
    return geo.country; // เช่น "TH", "US"
  }
  return "Unknown";
}

module.exports = { getCountryCodeFromIP };
