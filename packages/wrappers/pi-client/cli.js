#!/usr/bin/env node
// Thin wrapper — delegates to @marcfargas/pi-client.
// This unscoped package exists to prevent supply-chain attacks via npm name
// squatting. The real implementation lives in @marcfargas/pi-client.
import("@marcfargas/pi-client/cli");
