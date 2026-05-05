#!/bin/bash
# Start the opencode-kanban web server
export DB_PATH="/Users/fernando/opencode-kanban/kanban.db"
export WEB_PORT="3210"
exec /Users/fernando/.nvm/versions/node/v22.22.0/bin/node /Users/fernando/opencode-kanban/build/web.js
