#!/usr/bin/env node
"use strict";

import program from 'commander';
import {version} from '../package.json';

program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process')
  .command('watch','Live code reloading for SQL/Lua/Nginx configs')

program.parse(process.argv);
