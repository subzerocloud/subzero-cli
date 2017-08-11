#!/usr/bin/env node
"use strict";

import {COMPOSE_PROJECT_NAME, ENV_FILE, APP_DIR} from './env.js'
import program from 'commander';
import {version} from '../package.json';


program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process (experimental)');
program.parse(process.argv);
