#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
swiftc -O -framework Vision -framework CoreImage -framework ImageIO -framework CoreGraphics -framework UniformTypeIdentifiers "$DIR/idify-vision.swift" -o "$DIR/idify-vision"
echo "Compiled native idify-vision binary at $DIR/idify-vision"
