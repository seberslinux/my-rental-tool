---
name: rebuild
description: Rebuild the frontend (install deps + vite build) so local changes take effect
user_invocable: true
---

Rebuild the frontend so code changes are reflected locally.

Run these commands in sequence:
1. `cd client && npm install` — install any new dependencies
2. `cd client && npm run build` — compile the frontend into client/dist/

After completion, tell the user to restart `railway run npm start` in their terminal if the backend is already running.
