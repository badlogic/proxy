#!/bin/zsh
set -e
exec /usr/local/bin/ngrok http 9000 --url=badlogicproxy.ngrok.dev
