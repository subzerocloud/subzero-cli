#!/usr/bin/env node
"use strict";

import {program} from './program.js';
import runDashboard from './dashboard.js';
import { initMigrations, addMigration, test } from './migrations.js';
import {COMPOSE_PROJECT_NAME, ENV_FILE, APP_DIR} from './env.js'

if(!COMPOSE_PROJECT_NAME){
    console.log("\x1b[31mError:\x1b[0m You must set the COMPOSE_PROJECT_NAME var in the .env file");
    process.exit(0);
}


switch (process.env.CMD) {
  case 'dashboard':
    runDashboard();
    break;
  case 'init-migrations':
    initMigrations();
    process.exit(0);
    break;
  case 'add-migration':
    const {name, note} = process.env.CMD_OPTIONS;
    addMigration(name, note);
    process.exit(0);
    break;
  default:
    //console.log('Unknown command ' + process.env.CMD);
    test()
    process.exit(0);
    break;
}