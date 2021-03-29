#!/bin/sh

# allow namespace creation to fail, assume it already exists
kubectl create namespace INJECT_NAMESPACE || true

# set context to the namespace
kubectl config set-context --current --namespace=INJECT_NAMESPACE

# add/update the coder helm chart
helm repo update
helm repo add coder https://helm.coder.com

# install/upgrade coder (warning: this will ignore any manually-set values)
helm upgrade --namespace INJECT_NAMESPACE --install --atomic --wait coder coder/coder

# kind of lazy. sleep to make sure everything is ready for the CLI to continue
sleep 10