#!/bin/bash
set -euo pipefail

cd ~/Nauka/web-app/app

# sanity checks
test -d templates || { echo "No templates/ here. Run from the app root that contains templates/"; exit 1; }
command -v jq >/dev/null || { echo "jq not found. Install it: sudo apt install jq"; exit 1; }

mkdir -p var/llm

# Emit one JSON object per line, then wrap into { entries: [...] } with jq
find templates -type f -name '*.hbs' \
  | awk '
    {
      path=$0
      kind="route"
      if (path ~ /\/components\//) kind="component"
      if (path ~ /-(loading|error)\.hbs$/) kind="substate"
      routeName=""
      if (kind=="route") {
        routeName=path
        sub(/^templates\//,"",routeName)
        sub(/\.hbs$/,"",routeName)
        gsub(/\//,".",routeName)
      }
      # Print JSON without ridiculous escaping
      printf("{\"path\":\"%s\",\"kind\":\"%s\"", path, kind)
      if (routeName != "") {
        printf(",\"routeName\":\"%s\"", routeName)
      }
      printf("}\n")
    }
  ' \
  | jq -s '{ entries: . }' > var/llm/template-manifest.json

echo "Wrote $(jq '.entries|length' var/llm/template-manifest.json) entries to var/llm/template-manifest.json"
