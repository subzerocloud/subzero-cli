#!/usr/bin/env node
"use strict";

import program from 'commander';
import {version} from '../package.json';

program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process (experimental)')
  .command('cloud', 'Actions for your subzero.cloud account')
  .command('watch','Live code reloading for SQL/Lua/Nginx configs')
  .command('base-project','Download a base project');

program.parse(process.argv);
