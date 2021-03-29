const yargs = require("yargs/yargs");
import inquirer from "inquirer";
import { domain } from "process";
import { exit } from "yargs";
const { hideBin } = require("yargs/helpers");
const execa = require("execa");

// reading and writing in out/ folder
const fs = require("fs");

// TODO change this
const cloudflareEmail = "me@bpmct.net";
const cloudflareDomain = "coding.pics";

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

    // TODO: create different folders for each session
    console.log(
      "💾 FYI: All of these scripts are being saved in: " + argv.saveDir + "\n"
    );

    // switch to the absolute path of the home directory if the user included ~/
    if (argv.saveDir.startsWith("~/")) {
      const userHome = require("os").homedir();
      argv.saveDir = argv.saveDir.replace("~/", userHome + "/");
    }

    // create our out/ file to hold our creation script, among other things
    await execa("mkdir", ["-p", argv.saveDir]).catch((err) => {
      console.log(err);
    });

    // git init (or re-init so the user can easily source-control)
    await execa("git", ["init", argv.saveDir]);

    // add our lovely script to the out folder
    fs.writeFileSync(
      argv.saveDir + "/createCluster.sh",
      "#!/bin/sh\n" + gCloudCommand
    );
    await fs.chmodSync(argv.saveDir + "/createCluster.sh", "755");

    // TODO: find a way to actually make live updates work
    // or point the user to the URL to watch live.
    // ex. https://console.cloud.google.com/kubernetes/clusters/details/us-central1-a/coder/details?project=kubernetes-cluster-302420
    // we have all the info
    console.log("\n⏳ Creating your cluster. This will take a few minutes...");

    try {
      const subprocess = execa("/bin/sh", [argv.saveDir + "/createCluster.sh"]);
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
            name: "A domain name I own on Google CloudDNS",
            value: "cloud-dns",
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

    // hello
  } else if (argv.domainType == "cloud-dns") {
    console.log("Well, this is coming soon 💀");
    return 0;
  } else if (argv.domainType == "none") {
    console.log(
      "\nWarning: This means you can't use Coder with DevURLs, a primary way of accessing web services\ninside of a Coder Workspace:\n",
      "\t📄 Docs: https://coder.com/docs/environments/devurls\n",
      "\t🌎 Alternative: https://ngrok.com/docs (you can nstall this in your images)\n\n"
    );

    console.log(
      "You can always add a domain later, and use a custom provider via our docs.\n"
    );

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
