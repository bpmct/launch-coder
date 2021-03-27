const yargs = require("yargs/yargs");
import inquirer from "inquirer";
const { hideBin } = require("yargs/helpers");

const execa = require("execa");

require("dotenv").config();

export async function cli(args) {
  let argv = yargs(hideBin(args))
    .option("method", {
      alias: "m",
      type: "string",
      description: "Method for deploying Coder (gcloud, general-k8s)",
    })
    .option("domainType", {
      alias: "d",
      type: "string",
      description: "Domain for the Coder Deployment (auto, custom)",
    })
    .option("token", {
      type: "string",
      description: "API token for CloudFlare",
    })
    .option("domainName", {
      type: "string",
      description: "[Manual-only] Your custom domain for Coder",
    })
    .option("name", {
      type: "string",
      alias: "n",
      description: "Name for Coder subdomain",
    }).argv;

  // detect if we are on google cloud :)

  const checkGoogleCloud = await execa("/bin/sh", [
    // probably a silly way to do so, considering I can also ping in node
    // oh well. hackathon
    __dirname + "/../shell-helpers/detectGoogleCloud.sh",
  ]);
  if (!argv.method && checkGoogleCloud && checkGoogleCloud.stdout == "true") {
    console.log(
      "Auto-detected you are on Google Cloud, so we'll deploy there 🚀\nYou can manually change this by executing with --method"
    );
  } else if (argv.method == undefined) {
    console.log("YEP IT IS IN he", argv.method);
    argv = {
      ...argv,
      ...(await inquirer.prompt({
        type: "list",
        name: "method",
        message: "Where would you like to deploy Coder",
        choices: [
          {
            name: `Create a fresh Google Cloud cluster for me!`,
            value: "gcloud",
          },
          {
            name: "Install Coder on my current cluster (sketchy)",
            value: "k8s",
          },
        ],
      })),
    };
  }

  // determine which type of domain to use
  if (!argv.domainType) {
    argv = {
      ...argv,
      ...(await inquirer.prompt({
        type: "list",
        name: "domainType",
        message: "What type of domain would you like to use?",
        choices: [
          {
            name: `With a free domain from Coder (ex. [myname].${process.env.CLOUDFLARE_DOMAIN})`,
            value: "auto",
          },
          {
            name: "With a domain name I own on Google CloudDNS",
            value: "cloud-dns",
          },
        ],
      })),
    };
  }
  console.log("epic answer dood", argv);
}
