#!/bin/sh

# thanks https://gist.github.com/pydevops/cffbd3c694d599c6ca18342d3625af97#0212-enable-service


SERVICE="container.googleapis.com"
if [[ $(gcloud services list --format="value(serviceConfig.name)" \
                            --filter="serviceConfig.name:$SERVICE" 2>&1) != \
                            "$SERVICE" ]]; then
echo "false"
else
echo "true"
fi
