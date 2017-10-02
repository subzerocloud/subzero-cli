#!/usr/bin/env node
"use strict";

import program from 'commander';
import {version} from '../package.json';

program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process (experimental)')
  .command('service', 'Actions for your subzero account');

program.on('--help', function(){
  console.log('');
  console.log('  Env vars that control behaviour and their default values:');
  console.log('');
  console.log('    LOG_LENGTH: 1000');
  console.log('    APGDIFF_JAR_PATH: apgdiff-2.5-subzero.jar') 
  console.log('    SQITCH_CMD: sqitch') 
  console.log('    PSQL_CMD: psql');
  console.log('    PG_DUMP_CMD: pg_dump');
  console.log('    PG_DUMPALL_CMD: pg_dumpall');
  
  console.log('');
});
program.parse(process.argv);
