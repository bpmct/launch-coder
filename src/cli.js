const yargs = require("yargs/yargs");
import inquirer from "inquirer";
import { domain } from "process";
import { exit } from "yargs";
const { hideBin } = require("yargs/helpers");
const execa = require("execa");

// reading and writing in scripts for the user
const fs = require("fs").promises;

// API calls
const axios = require("axios").default;

// this data isn't exactly confidental, but is necessary for the program to run
// TODO: make this accessible via an external endpoint or something
const cloudflareEmail = "me@bpmct.net";
const cloudflareDomain = "coding.pics";
const cloudflareZone = "d8a2eda8c28877a96a209af791f739c8";

require("dotenv").config();

const runHelperScript = async (filename, params) => {
  try {
    let run = await execa("/bin/sh", [
      __dirname + `/../shell-helpers/${filename}.sh`,
    ]);

    if (run && run.stdout) {
      return run.stdout;
    }
  } catch (err) {
    throw err;
    return;
  }
};

const createProjectDir = async (saveDir) => {
  // TODO: create different folders for each session
  console.log(
    "💾 FYI: Scripts & config are being saved in: " +
      saveDir +
      "\nfor future use\n"
  );

  // create our out/ file to hold our creation script, among other things
  await execa("mkdir", ["-p", saveDir]).catch((err) => {
    console.log(err);
  });

  // git init (or re-init so the user can easily source-control)
  await execa("git", ["init", saveDir]);

  return true;
};

const generateGoogleClusterCommand = (argv) => {
  // TODO: omit zone if it is intentionally left blank to support regional clusters
  // note: this will involve modifying other gcloud commands that mention --zone
  return `gcloud beta container --project "${argv.gcloudProjectId}" \\
    clusters create "${argv.gcloudClusterName}" \\
    --zone "${argv.gcloudClusterZone}" \\
    --no-enable-basic-auth \\
    --node-version "latest" \\
    --cluster-version "latest" \\
    --machine-type "${argv.gcloudClusterMachineType}" \\
    --image-type "UBUNTU" \\
    --disk-type "pd-standard" \\
    --disk-size "50" \\
    --metadata disable-legacy-endpoints=true \\
    --scopes "https://www.googleapis.com/auth/cloud-platform" \\
    --num-nodes "${argv.gcloudClusterMinNodes}" \\
    --enable-stackdriver-kubernetes \\
    --enable-ip-alias \\
    --network "projects/${argv.gcloudProjectId}/global/networks/default" \\
    --subnetwork "projects/${argv.gcloudProjectId}/regions/${
    argv.gcloudClusterRegion
  }/subnetworks/default" \\
    --default-max-pods-per-node "110" \\
    --addons HorizontalPodAutoscaling,HttpLoadBalancing \\
    --enable-autoupgrade \\
    --enable-autorepair \\${
      argv.gcloudClusterPreemptible ? "\n    --preemptible \\" : ""
    }
    --enable-network-policy \\
    --enable-autoscaling \\
    --min-nodes "${argv.gcloudClusterMinNodes}" \\
    --max-nodes "${argv.gcloudClusterMaxNodes}"\n`;
};

export async function cli(args) {
  let argv = yargs(hideBin(args))
    .option("method", {
      alias: "m",
      type: "string",
      description: "Method for deploying Coder (gcloud, general-k8s)",
    })
    .option("save-dir", {
      alias: "f",
      type: "string",
      default: "~/.config/launch-coder",
      description: "Path to save config files",
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
    })
    .option("namespace", {
      type: "string",
      default: "coder",
      description: "Namespace for Coder",
    })
    .option("gcloud-project-id", {
      type: "string",
    })
    .option("gcloud-cluster-name", {
      type: "string",
      default: "coder",
    })
    .option("gcloud-cluster-region", {
      type: "string",
      default: "us-central1",
    })
    .option("gcloud-cluster-zone", {
      type: "string",
      default: "us-central1-a",
    })
    .option("gcloud-cluster-machine-type", {
      type: "string",
      default: "e2-highmem-4",
    })
    .option("gcloud-cluster-preemptible", {
      type: "boolean",
      default: true,
    })
    .option("gcloud-cluster-autoscaling", {
      type: "boolean",
      default: true,
    })
    .option("gcloud-cluster-min-nodes", {
      type: "number",
      default: 1,
    })
    .option("gcloud-cluster-max-nodes", {
      type: "number",
      default: 3,
    })
    .option("skip-confirm-prompts", {
      type: "boolean",
    }).argv;

  // detect if we are on google cloud :)

  const checkCloudShell = await runHelperScript("detectCloudShell");

  if (!argv.method && checkCloudShell && checkCloudShell == "true") {
    console.log("It looks like you are using Google Cloud Shell 🚀");

    const gcloudCheck = await inquirer.prompt({
      type: "confirm",
      default: true,
      name: "confirm",
      message: "Do you want to deploy a new Coder cluster?",
    });

    if (gcloudCheck.confirm) {
      argv.method = "gcloud";
    }
  }

  if (argv.method == undefined) {
    argv = {
      ...argv,
      ...(await inquirer.prompt({
        type: "list",
        name: "method",
        message: "Where would you like to deploy Coder?",
        choices: [
          {
            name: `Create a fresh Google Cloud cluster for me and install Coder`,
            value: "gcloud",
          },
          {
            name: "Install Coder on my current cluster",
            value: "k8s",
          },
        ],
      })),
    };
  }

  // switch to the absolute path of the home directory if the user included ~/
  if (argv.saveDir.startsWith("~/")) {
    const userHome = require("os").homedir();
    argv.saveDir = argv.saveDir.replace("~/", userHome + "/");
  }

  if (argv.method == "gcloud") {
    // ensure gcloud-cli is installed and active

    // TODO: add better user education on what the prereqs are
    try {
      await runHelperScript("googleCloudPrereqs");
      console.log("✅", "You seem to have all the dependencies installed!");
    } catch (err) {
      console.log("❌", err.stderr);
      return;
    }

    if (!argv.gcloudProjectId) {
      let defaultProject = false;
      let projects = [];

      // try to get the default project
      try {
        const listOfProjects = await runHelperScript(
          "googleCloudDefaultProject"
        );

        defaultProject = await runHelperScript("googleCloudDefaultProject");
        const projectsJson = await runHelperScript("googleCloudProjects");
        projects = JSON.parse(projectsJson).map((project) => {
          return project.projectId;
        });

        // ensure we are actually fetching IDs
        if (projects[0] == undefined) {
          throw "could not read project ID";
        }

        console.log("📄 Got a list of your Google Cloud projects!\n");
      } catch (err) {
        // reset projects list
        projects = [];
      }

      // show a select field if we found a list
      if (projects.length) {
        argv = {
          ...argv,
          ...(await inquirer.prompt({
            type: "list",
            name: "gcloudProjectId",
            default: defaultProject,
            message: `Google Cloud Project:`,
            validate: (that) => {
              // TODO: validate this project actually exists
              return that != "";
            },
            choices: projects,
          })),
        };
      } else {
        console.log(
          "🤔 We couldn't determine if you have any Google Cloud Projects.\n",
          "\t➡️ Create one here: https://console.cloud.google.com/projectcreate"
        );
        argv = {
          ...argv,
          ...(await inquirer.prompt({
            type: "input",
            name: "gcloudProjectId",
            default: undefined,
            message: `Google Cloud Project:`,
            validate: (that) => {
              // TODO: validate this project actually exists
              return that != "";
            },
            choices: [
              {
                name: `Create a fresh Google Cloud cluster for me and install Coder`,
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
    }

    let gCloudCommand = generateGoogleClusterCommand(argv);

    // TODO: add info on what this cluster means

    // TODO: impliment pricing calculations with Google API
    let pricing_info = "";

    if (
      argv.gcloudClusterRegion == "us-central1" &&
      argv.gcloudClusterZone == "us-central1-a" &&
      argv.gcloudClusterMachineType == "e2-highmem-4" &&
      argv.gcloudClusterMinNodes == "1" &&
      argv.gcloudClusterMaxNodes == "3" &&
      argv.gcloudClusterAutoscaling &&
      argv.gcloudClusterPreemptible
    ) {
      pricing_info =
        "This cluster will cost you roughly $40-120/mo to run on Google Cloud depending on usage." +
        "\nQuestions about cluster size? Ask at https://cdr.co/join-community" +
        "\n\nNote: this is just an estimate, we recommend researching yourself and monitoring billing:";
    } else {
      pricing_info =
        "You are not using default settings. Be sure to calculate the pricing info for your cluster";
    }
    console.log(
      "\n💻 Your command is:",
      "\n------------\n",

      gCloudCommand,
      "\n------------",
      "\n\n💵 " + pricing_info + "\n",
      "\t➡️ GKE Pricing: https://cloud.google.com/kubernetes-engine/pricing\n",
      "\t➡️ Storage pricing: https://cloud.google.com/compute/disks-image-pricing\n",
      "\t➡️ Machine pricing: https://cloud.google.com/compute/all-pricing\n\n",
      "\t➡️ or use the Google Cloud Pricing Calculator: https://cloud.google.com/products/calculator\n",
      "\n------------"
    );

    // TODO: impliment ability to edit cluster command in the cli (wohoo)

    if (!argv.skipConfirmPrompts) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Do you want to run this command?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\n\nOk :) Feel free to modify the command as needed, run it yourself, then you can run "launch-coder --method k8s" to install Coder on the cluster you manually created`
        );
        return;
      }
    }

    await createProjectDir(argv.saveDir);

    // add our lovely script to the out folder
    await fs.writeFile(
      argv.saveDir + "/create-cluster.sh",
      "#!/bin/sh\n" + gCloudCommand
    );
    await fs.chmod(argv.saveDir + "/create-cluster.sh", "755");

    // TODO: find a way to actually make live updates work
    // or point the user to the URL to watch live.
    // ex. https://console.cloud.google.com/kubernetes/clusters/details/us-central1-a/coder/details?project=kubernetes-cluster-302420
    // we have all the info
    console.log("\n⏳ Creating your cluster. This will take a few minutes...");

    try {
      const subprocess = execa("/bin/sh", [
        argv.saveDir + "/create-cluster.sh",
      ]);
      subprocess.stdout.pipe(process.stdout);
      const { stdout } = await subprocess;
      // TODO: consolidate the spacers
      console.log("------------");
      console.log(
        "✅",
        `Cluster "${argv.gcloudClusterName}" has been created!`
      );
    } catch (err) {
      console.log("❌", "Process failed\n\n\n", err.stderr);
      return;
    }

    try {
      await execa(
        "gcloud",
        `container clusters get-credentials ${argv.gcloudClusterName} --zone ${argv.gcloudClusterZone}`.split(
          " "
        )
      );
      console.log("✅", "Added to kube context");
    } catch (err) {
      console.log("❌", "Unable to add to kube context:\n\n\n", err.stderr);
      return;
    }

    // So now we can move on to installing Coder!
  }

  // if argv.method == "gcloud" at this point
  // the script has succeeded in creating the cluster
  // and switched context
  if (argv.method != "k8s" && argv.method != "gcloud") {
    // TODO: standardize these
    console.error("Error. Unknown method: " + argv.method);
    return;
  } else if (argv.method == "k8s") {
    // TODO: add checks to ensure the user has a cluster,
    // and it has the necessary stuff for Coder
    console.log(
      "This script does not currently verify that your cluster is ready for Coder.\n\nWe recommend checking the docs before continuing:"
    );
    console.log("\t➡️ https://coder.com/docs/setup/requirements\n");

    if (!argv.skipConfirmPrompts) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Do you to proceed?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\nExited. If you have any questions, feel free reach out on Slack:\n\t➡️ https://cdr.co/join-community\n`
        );
        return 0;
      }
    }
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
            name: `A free domain from Coder (ex. [myname].${cloudflareDomain})`,
            value: "auto",
          },
          {
            name: "A domain name I own on Google CloudDNS (Coming soon)",
            value: "cloud-dns",
          },
          {
            name: "A domain name I own on CloudFlare (Coming soon)",
            value: "cloudflare",
          },
          {
            name: "Do not set up a domain for now",
            value: "none",
          },
        ],
      })),
    };
  } else {
    console.log("------------");
  }

  // validate domainType
  if (argv.domainType == "auto") {
    // check if we have the cloudflare token
    if (!process.env.DOMAIN_TOKEN) {
      console.log(
        "\n🔒 At this time, you need a special token from a Coder rep to get a subdomain\n" +
          "For more info, join our Slack Community: https://cdr.co/join-community"
      );
      return;
    }

    // sha256 validate the token
    // used for verifying domain token
    var sha256 = require("js-sha256");

    // verify the token
    // TODO: potentially do this server-side so that expired tokens
    // don't get improperly verified on an old local version
    if (
      sha256(process.env.DOMAIN_TOKEN) !=
      "7d3eb96148c592b64ddfb4f3038a329acc22ea94669780dfa9de85b768ed27b1"
    ) {
      console.log("\n❌ The domain token you supplied is not valid.");
      return;
    }

    const validateName = (name) => {
      // TODO: possibly add error message here
      var regex = new RegExp("^[a-zA-Z]+[a-zA-Z0-9\\-]*$");
      if (!regex.test(name)) {
        console.log("❗ Please enter a valid name (ex. `acme-co`)");
        return false;
      }
      return true;
    };

    // determine which type of domain to use
    if (!argv.name) {
      argv = {
        ...argv,
        ...(await inquirer.prompt({
          type: "input",
          name: "name",
          message: `Enter a name for your Coder deployment (____.${cloudflareDomain}):`,
          validate: validateName,
        })),
      };
    } else {
      validateName(argv.name);
    }
    const domainName = argv.name + "." + cloudflareDomain;

    // ensure this domain has not been used
    try {
      const domainSearch = await axios.request({
        method: "GET",
        url: `https://api.cloudflare.com/client/v4/zones/${cloudflareZone}/dns_records?name=${encodeURIComponent(
          domainName
        )}`,
        headers: {
          Authorization: `Bearer ${process.env.DOMAIN_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
      if (domainSearch.data.result.length) {
        console.log(
          `\nError: The domain ${domainName} has been used before. Use another or contact us at https://cdr.co/join-community`
        );
        return;
      }
    } catch (err) {
      console.log(`Error connecting to CloudFlare:`, err);
      return;
    }

    // create dir for our files
    // TODO: make this a bit smarter and only run if method == "k8s" as this is being done in gcloud
    await createProjectDir(argv.saveDir);

    // get the base config
    let issuer = await fs.readFile(
      __dirname + "/../config-store/cloudflare-issuer.yaml",
      "utf8"
    );
    let helm = await fs.readFile(
      __dirname + "/../config-store/helm-values.yaml",
      "utf8"
    );

    // add our values to the sample file
    // TODO: add validation to all these values
    helm = helm.split("INJECT_USER_DOMAIN").join(domainName);
    issuer = issuer.split("INJECT_USER_NAMESPACE").join(argv.namespace);
    issuer = issuer
      .split("INJECT_CLOUDFLARE_API")
      .join(process.env.DOMAIN_TOKEN);
    issuer = issuer.split("INJECT_USER_EMAIL").join(cloudflareEmail);
    issuer = issuer.split("INJECT_USER_DOMAIN").join(domainName);
    issuer = issuer.split("INJECT_CLOUDFLARE_EMAIL").join(cloudflareEmail);

    if (issuer.includes("INJECT_") || helm.includes("INJECT_")) {
      console.log(
        "❌",
        "Information was not injected into the files correctly. An error occured."
      );
      return;
    }
    // write the issuer and helm config to a file with a trailing newline
    try {
      await fs.writeFile(argv.saveDir + "/issuer.yaml", issuer + "\n");
      await fs.writeFile(argv.saveDir + "/values.yaml", helm + "\n");
    } catch (err) {
      console.log("❌ An error occured writing the config files", err);
    }

    console.log(
      "\n✅ Created the following config files:\n",
      "\t📄 issuer.yaml: Configures a LetsEncrypt issuer for our domain\n",
      "\t📄 values.yaml: Values for our Coder helm chart, telling it our URL and to point to the issuer\n"
    );

    // TODO: confirm cert-manager exists first
    console.log(
      "We need need to deploy cert-manager 1.0.1 to work with a domain. If you already have it installed, we can re-deploy harmlessly."
    );

    if (!argv.skipConfirmPrompts) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Deploy cert-manager on your cluster?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\nCancelled the install. If you have any questions, feel free reach out on Slack:\n\t➡️ https://cdr.co/join-community\n`
        );
        return 0;
      }
    }

    try {
      console.log(
        "\n⏳ Installing cert-manager. This will take a couple minutes..."
      );
      // TODO: confirm this better.
      const checkCertManager = await runHelperScript("installCertManager");
      // remove any weird spaces
      const certManagerPods = checkCertManager.split(" ").join("");

      if (certManagerPods >= 3) console.log("✅", "Installed cert-manager");
      else {
        throw "could not detect pods running";
      }
    } catch (err) {
      console.log("❌", "An error occured installing cert-manager:", err);
      return;
    }

    let installScript = await fs.readFile(
      __dirname + "/../config-store/update-coder.sh",
      "utf8"
    );
    // add our values to the sample file
    // TODO: add validation to all these values
    installScript = installScript
      .split("INJECT_NAMESPACE")
      .join(argv.namespace);
    installScript = installScript.split("INJECT_SAVEDIR").join(argv.saveDir);

    // ensure we injected everything OK
    if (installScript.includes("INJECT_")) {
      console.log(
        "❌",
        "Information was not injected into the install script correctly. An error occured."
      );
      return;
    }

    try {
      await fs.writeFile(argv.saveDir + "/update-coder.sh", installScript);
      await fs.chmod(argv.saveDir + "/update-coder.sh", "755");
    } catch (err) {
      console.log("❌ An error occured writing the install script", err);
    }

    console.log(
      "\n\n✅ Created an install/upgrade script that:\n",
      "\t🌎 Deploys our issuer (issuer.yaml)\n",
      "\t📊 Adds/updates the Coder helm chart\n",
      `\t🚀 Installs/upgrades Coder with our values (values.yaml)\n\n` +
        `💻 Preview it at: ${argv.saveDir}/update-coder.sh\n`
    );

    if (!argv.skipConfirmPrompts) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Do you want to run this command and install Coder?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\n\nOk :) Feel free to modify the command as needed and run it yourself.`
        );
        return;
      }
    }

    const subprocess = execa("/bin/sh", [argv.saveDir + "/update-coder.sh"]);
    console.log("------------");

    subprocess.stdout.pipe(process.stdout);
    const { stdout } = await subprocess;
    // TODO: consolidate the spacers
    console.log("------------");

    console.log("\n⏳ Setting up the domain...");

    // fetch our admin password now, but save it for later
    const loginDetails = await runHelperScript("getAdminPassword");

    const coderIP = await runHelperScript("getCoderIP").catch((err) => {
      console.log(
        "Error fetching the IP address for your Coder deployment. We can't set up the DNS records :("
      );
      return 1;
    });

    // set up DNS records to point the subdomain to the Coder IP
    try {
      // add record for root URL
      await axios.request({
        method: "POST",
        url: `https://api.cloudflare.com/client/v4/zones/${cloudflareZone}/dns_records`,
        headers: {
          Authorization: `Bearer ${process.env.DOMAIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          type: "A",
          name: argv.name,
          content: coderIP,
          ttl: 1,
          proxied: false,
        },
      });
      await axios.request({
        method: "POST",
        url: `https://api.cloudflare.com/client/v4/zones/${cloudflareZone}/dns_records`,
        headers: {
          Authorization: `Bearer ${process.env.DOMAIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        data: {
          type: "A",
          name: "*." + argv.name,
          content: coderIP,
          ttl: 1,
          proxied: false,
        },
      });
    } catch (err) {
      console.log(
        "\n\n",
        "❌",
        "Error setting up this subdomain... For help, contact us at https://cdr.co/join-community"
      );
    }

    console.log(
      "\n\n🎉 Coder has been installed! Log in at https://" + domainName
    );
    if (loginDetails == "") {
      // TODO: allow the user to reset from here
      console.log(
        "\nWe couldn't find your admin password. See the docs on how to reset it: \n\t➡️ https://coder.com/docs/admin/access-control/password-reset#resetting-the-site-admin-password"
      );
    } else {
      console.log(loginDetails);
    }

    // create our script
  } else if (
    argv.domainType == "cloud-dns" ||
    argv.domainType == "cloudflare"
  ) {
    console.log(
      "This is coming soon. For support doing this, join the community: https;//cdr.co/join-community"
    );
    return 0;
  } else if (argv.domainType == "none") {
    console.log(
      "\nWarning: This means you can't use Coder with DevURLs, a primary way of accessing web services\ninside of a Coder Workspace:\n",
      "\t📄 Docs: https://coder.com/docs/environments/devurls\n",
      "\t🌎 Alternative: https://ngrok.com/docs (you can install this in your images)\n\n"
    );

    console.log(
      "You can always add a domain later, and use a custom provider via our docs.\n"
    );

    // TODO: definitely fix me!!
    // very sad repeated code :(
    // i wanted 2 working options
    let installScript = await fs.readFile(
      __dirname + "/../config-store/update-coder-no-domain.sh",
      "utf8"
    );

    // ensure we injected everything OK
    if (installScript.includes("INJECT_")) {
      console.log(
        "❌",
        "Information was not injected into the install script correctly. An error occured."
      );
      return;
    }

    try {
      await fs.writeFile(argv.saveDir + "/update-coder.sh", installScript);
      await fs.chmod(argv.saveDir + "/update-coder.sh", "755");
    } catch (err) {
      console.log("❌ An error occured writing the install script", err);
    }

    console.log(
      "\n\n✅ Created an install/upgrade script that:\n",
      "\t📊 Adds/updates the Coder helm chart\n",
      `\t🚀 Installs/upgrades Coder\n\n` +
        `💻 Preview it at: ${argv.saveDir}/update-coder.sh\n`
    );

    if (!argv.skipConfirmPrompts) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Do you want to run this command and install Coder?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\n\nOk :) Feel free to modify the command as needed and run it yourself.`
        );
        return;
      }
    }

    const subprocess = execa("/bin/sh", [argv.saveDir + "/update-coder.sh"]);
    console.log("------------");

    subprocess.stdout.pipe(process.stdout);
    const { stdout } = await subprocess;
    // TODO: consolidate the spacers
    console.log("------------");

    // fetch our admin password now
    const loginDetails = await runHelperScript("getAdminPassword");

    const coderIP = await runHelperScript("getCoderIP").catch((err) => {
      console.log("Error fetching the IP address for your Coder deployment.");
      return 1;
    });

    console.log("\n\n🎉 Coder has been installed! Log in at http://" + coderIP);
    if (loginDetails == "") {
      // TODO: auto reset it?
      console.log(
        "\nWe couldn't find your admin password. See the docs on how to reset it: https://coder.com/docs/admin/access-control/password-reset#resetting-the-site-admin-password"
      );
    } else {
      console.log(loginDetails);
    }

    // TODO: add confirmations
  } else {
    // TODO: standardize these
    console.error("Error. Unknown domainType: " + argv.domainType);
    return;
  }

  // install and access Coder

  // TODO: tell the user they can save this to a PRIVATE
  // repo in GIT (maybe idk if that is bad practice)
  console.log("\n\nat the end with a long argv:", Object.keys(argv).length);
}
