#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: scripts/filter-ios.sh <plugin repo> <commit> <empty work dir>" >&2
  echo "Clones <commit> of the Studio plugin repository into <work dir>, keeps only" >&2
  echo "the history of apps/ios, moves it to ios/, and prints the filtered tip." >&2
  exit 2
fi

source_repo=$1
commit=$2
work=$3

if [ -e "$work" ] && [ -n "$(ls -A "$work")" ]; then
  echo "filter-ios: $work is not empty" >&2
  exit 1
fi

git clone -q --no-local --no-checkout "$source_repo" "$work"
cd "$work"
git checkout -q -B import "$commit"
for ref in $(git for-each-ref --format='%(refname)' refs/remotes refs/tags); do
  git update-ref -d "$ref"
done
git for-each-ref --format='%(refname)' refs/heads | grep -vx refs/heads/import | while read -r ref; do
  git update-ref -d "$ref"
done
git remote remove origin

git filter-repo --force --quiet \
  --path apps/ios/ \
  --path-rename apps/ios/:ios/

git rev-parse import
