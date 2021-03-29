#!/bin/sh

# Install cert-manager
kubectl apply --validate=false -f https://github.com/jetstack/cert-manager/releases/download/v1.0.1/cert-manager.yaml >> /dev/null

# Verify it is installed
sleep 10
kubectl get pods -n cert-manager --field-selector=status.phase=Running --no-headers | wc -l 