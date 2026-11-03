#!/usr/bin/env node
import pkg from '../package.json' with { type: 'json' };

const version = pkg.version;
const flag = process.argv.includes('--version') || process.argv.includes('-v');
console.log(flag ? version : `terrific-cli ${version}: not implemented yet`);
process.exit(0);
