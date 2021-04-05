# launch-coder

⚠️: This was a hackathon project and is not recommended for production deployments or in sensitive environments.

---

Launch [Coder](https://coder.com) in a simple way. It can:

- Create the recommended Google Cloud Cluster for you
- Install Coder with an automatic domain name: `[yourname].coding.pics`

Preferred environment: Google Cloud Shell. It just works.

## How to use

No need to install the CLI tool locally, run from NPM:

```sh
# For a guided install:
npx @bpmct/launch-coder

# See all commands:
npx @bpmct/launch-coder --help
```

## Install on your machine

```sh

npm i -g launch-coder

launch-coder

```

launch-coder will not install or provision anything without your permission :)

## Troubleshooting

On non-public Dev URLs: `An internal server error occurred`:

- This is an error I get frequently with Dev URLs, GKE, and CloudFlare domains, and it always seems to go away.
  - Re-create Dev URL
  - Re create environment
  - Wait patiently
  - Last resort: Make Dev URL public

---

Questions? Join Slack [https://cdr.co/join-community](https://cdr.co/join-community)
