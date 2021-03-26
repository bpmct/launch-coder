require("dotenv").config();
const axios = require("axios").default;
const fs = require("fs").promises;
const { exec, spawn, fork, execFile } = require("promisify-child-process");

let inject = {
  user_domain: `newest.coding.pics`,
  user_email: "victorialslocum@gmail.com",
  user_namespace: "script",
  cloudflare_email: process.env.CLOUDFLARE_EMAIL,
  cloudflare_api: process.env.CLOUDFLARE_TOKEN,
};

let generateCommands = async () => {
  let issuer = await fs.readFile("config-store/cloudflare-issuer.yaml", "utf8");
  let helm = await fs.readFile("config-store/helm-values.yaml", "utf8");
  for (const [key, value] of Object.entries(inject)) {
    // replaces INJECT_KEY with the proper value
    issuer = issuer.split("INJECT_" + key.toUpperCase()).join(value);
    helm = helm.split("INJECT_" + key.toUpperCase()).join(value);
  }

  // write the issuer and helm config to a file with a trailing newline
  await fs.writeFile("your_issuer.yaml", issuer + "\n");
  await fs.writeFile("your_values.yaml", helm + "\n");

  console.log(
    "\n\n[auto-coder] Fantastic. You can now deploy Coder with: 👇\n--------"
  );
  console.log(`kubectl apply -f your_issuer.yaml`);
  console.log(
    `helm install coder coder/coder --namespace ${inject.user_namespace} --values your_values.yaml`
  );
  const fetchIPData = await spawn(`./shell-helpers/getCoderIP.sh`, {
    encoding: "utf8",
  }).catch((err) => console.log("no IP yet..."));

  if (fetchIPData) {
    console.log(fetchIPData.stdout);
  }
};

generateCommands();
