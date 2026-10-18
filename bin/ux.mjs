#!/usr/bin/env node
// The old name. ux-mapper is now Lathe: this forwards to bin/lathe.mjs.
if (process.stdout.isTTY) console.error("ux is now lathe: node lathe/bin/lathe.mjs <command> <repo>");
await import("./lathe.mjs");
