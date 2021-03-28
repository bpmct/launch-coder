const yargs = require("yargs/yargs");
import inquirer from "inquirer";
import { exit } from "yargs";
const { hideBin } = require("yargs/helpers");

const execa = require("execa");

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
  return `$ gcloud beta container --project "${argv.gcloudProjectId}" \\
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
    --network "projects/$PROJECT_ID/global/networks/default" \\
    --subnetwork "projects/$PROJECT_ID/regions/${
      argv.gcloudClusterZone
    }/subnetworks/default" \\
    --default-max-pods-per-node "110" \\
    --addons HorizontalPodAutoscaling,HttpLoadBalancing \\
    --enable-autoupgrade \\
    --enable-autorepair \\${
      argv.gcloudClusterPreemtible ? "\n    --preemtible \\" : ""
    }
    --enable-network-policy \\
    --enable-autoscaling \\
    --min-nodes "${argv.gcloudClusterMinNodes}" \\
    --max-nodes "${argv.gcloudClusterMaxNodes}"`;
};

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
    })
    .option("gcloud-project-id", {
      type: "string",
    })
    .option("gcloud-cluster-name", {
      type: "string",
      default: "coder",
    })
    .option("gcloud-cluster-zone", {
      type: "string",
      default: "us-central1-a",
    })
    .option("gcloud-cluster-machine-type", {
      type: "string",
      default: "e2-highmem-4",
    })
    .option("gcloud-cluster-preemtible", {
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
    // TODO: determine better naming for this:
    .option("gcloud-skip-confirm-prompt", {
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
            name: "Install Coder on my current cluster (sketchy)",
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

        // TODO: ensure it is actually no biggie
        console.log("Ran into an error fetching your projects... No biggie 🙂");
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
      } else
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

    let gCloudCommand = generateGoogleClusterCommand(argv);

    // TODO: impliment pricing calculations with Google API
    let pricing_info = "";

    if (
      argv.gcloudClusterZone == "us-central1-a" &&
      argv.gcloudClusterMachineType == "e2-highmem-4" &&
      argv.gcloudClusterMinNodes == "1" &&
      argv.gcloudClusterMaxNodes == "3" &&
      argv.gcloudClusterAutoscaling &&
      argv.gcloudClusterPreemtible
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

    if (!argv.gcloudSkipConfirmPrompt) {
      const runCommand = await inquirer.prompt({
        type: "confirm",
        default: true,
        name: "runIt",
        message: "Do you want to run this command?",
      });

      if (!runCommand.runIt) {
        console.log(
          `\n\nOk :) Feel free to modify the command as needed, run it yourself, then you can run "launch-coder --mode k8s" to install Coder on the cluster you manually created`
        );
        return 0;
      }
    }

    const subprocess = execa("ping", ["google.com", "-c", "5"]);
    subprocess.stdout.pipe(process.stdout);
    const { stdout } = await subprocess;
    console.log("WE KNOW THE PROCESS HAS COMPLETED");

    // execa("echo", ["unicorns"]).stdout.pipe(process.stdout);
  } else if (argv.method == "k8s") {
    console.log("coming sooon moo");
  } else {
    console.error("Error. Unknown method: " + argv.method);
    return;
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
  console.log("\n\nat the end with a long argv:", Object.keys(argv).length);
}
