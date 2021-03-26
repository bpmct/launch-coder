#!/bin/sh

kubectl get service ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'