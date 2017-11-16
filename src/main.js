#!/usr/bin/env node
"use strict";

import program from 'commander';
import {version} from '../package.json';
import proc from 'child_process';
import inquirer from 'inquirer';
import {runCmd, notEmptyString} from './common.js';
import colors from 'colors';

program
  .version(version)
  .command('dashboard', 'Open dashboard')
  .command('migrations', 'Manage database migrations process (experimental)')
  .command('cloud', 'Actions for your subzero.cloud account');

// program.on('--help', function(){
//   console.log('');
//   console.log('  Env vars that control behaviour and their default values:');
//   console.log('');
//   console.log('    LOG_LENGTH: 1000');
//   console.log('    APGDIFF_JAR_PATH: /usr/local/bin/apgdiff.jar') 
//   console.log('    SQITCH_CMD: sqitch') 
//   console.log('    PSQL_CMD: psql');
//   console.log('    PG_DUMP_CMD: pg_dump');
//   console.log('    PG_DUMPALL_CMD: pg_dumpall');
//   console.log('');
// });

program
  .command('base-project')
  .description('Download a base project')
  .action(() => {
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter the directory path where you want to create the project",
        name: 'dir',
        default: '.',
        validate: val => notEmptyString(val)?true:"Please enter a dir"
      },
      {
        type: 'list',
        name: 'repo',
        message: 'Choose the starter kit',
        choices: [
          {
            name: 'postgrest-starter-kit (REST)',
            value: 'https://github.com/subzerocloud/postgrest-starter-kit'
          },
          {
            name: 'subzero-starter-kit (REST & GraphQL)',
            value: 'https://github.com/subzerocloud/subzero-starter-kit'
          }
        ]
      }
    ]).then(answers => baseProject(answers.dir, answers.repo));
  });

const baseProject = (dir, repo) => {
  runCmd("git", ["clone", repo, dir]);
  runCmd("git", ["--git-dir", `${dir}/.git`, "remote", "rename", "origin", "upstream"]);
  console.log("\nYou can now do:\n");
  console.log("git remote add origin <your git repo url here>".white);
  console.log("git push -u origin master".white);
  console.log("");
}

program.parse(process.argv);
