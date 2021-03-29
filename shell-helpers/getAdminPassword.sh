#!/bin/sh

kubectl logs -n coder -l coder.deployment=cemanager -c cemanager --tail=-1 | grep -A1 -B2 Password