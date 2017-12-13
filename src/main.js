#!/usr/bin/env node
"use strict";

import os from 'os';
import program from 'commander';
import {version} from '../package.json';
import proc from 'child_process';
import inquirer from 'inquirer';
import {runCmd, notEmptyString} from './common.js';
import colors from 'colors';
import { DOCKER_IMAGE, DOCKER_APP_DIR } from './env.js';

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
            value: 'https://github.com/subzerocloud/postgrest-starter-kit/archive/master.tar.gz'
          },
          {
            name: 'subzero-starter-kit (REST & GraphQL)',
            value: 'https://github.com/subzerocloud/subzero-starter-kit/archive/master.tar.gz'
          }
        ]
      }
    ]).then(answers => baseProject(answers.dir, answers.repo));
  });

const baseProject = (dir, repo) => {
  let {uid, gid} = os.userInfo();
  proc.execSync(`docker run -u ${uid}:${gid} -v ${process.cwd()}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE} sh -c 'mkdir -p ${dir} && wget -qO- ${repo} | tar xz -C ${dir} --strip-components=1'`);
}

program.parse(process.argv);
