#!/usr/bin/env node
// Thin wrapper — delegates to @marcfargas/pi-server.
// This unscoped package exists to prevent supply-chain attacks via npm name
// squatting. The real implementation lives in @marcfargas/pi-server.
import("@marcfargas/pi-server/cli");
