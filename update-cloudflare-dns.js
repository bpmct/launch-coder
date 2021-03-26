require("dotenv").config();
const axios = require("axios").default;

let ip = "34.67.78.1";

let domain = "newest.coding.pics";

// d8a2eda8c28877a96a209af791f739c8

var options = {
  method: "POST",
  url: `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/dns_records`,
  headers: {
    Authorization: `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
    "Content-Type": "application/json",
  },
  data: {
    type: "A",
    name: domain,
    content: ip,
    ttl: 1,
    proxied: false,
  },
};

axios
  .request(options)
  .then(function (response) {
    console.log(response.data.result);
  })
  .catch(function (error) {
    console.error(error);
  });
