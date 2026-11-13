#!/bin/sh
# Compile the scanner into one executable. This file, and only this file,
# gets Full Disk Access so the nightly job can read Messages.
set -eu
cd "$(dirname "$0")/.."
mkdir -p bin
bun build --compile src/scan.ts --outfile bin/perceptle-scan
echo "built $(pwd)/bin/perceptle-scan"
