#!/bin/sh

if [[ $(hostname -s) == "cs-"* ]]; then
    echo true
else
    echo false
fi