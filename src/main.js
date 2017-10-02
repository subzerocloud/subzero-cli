#!/usr/bin/env node
"use strict";

import program from 'commander';
import {version} from '../package.json';
import proc from 'child_process';
import inquirer from 'inquirer';

program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process (experimental)')
  .command('cloud', 'Actions for your subzero.cloud account');

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

program
  .command('base-project')
  .description('Download a base project')
  .action(() => {
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter a dir(Use '.' for current dir)",
        name: 'dir',
        validate: val => notEmptyString(val)?true:"Please enter a dir"
      }
    ]).then(answers => baseProject(answers.dir));
  });

const notEmptyString = s => (typeof s == 'string')&&s.trim().length;

const baseProject = dir => {
  let p   = proc.spawnSync("git", ["clone", "https://github.com/subzerocloud/postgrest-starter-kit", dir]),
      out = p.stdout.toString(),
      err = p.stderr.toString();
  if(err){
    console.log(err);
    process.exit(1);
  } else {
    console.log(out);
  }
}

program.parse(process.argv);
