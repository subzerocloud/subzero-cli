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
      },
      {
        type: 'confirm',
        message: "Do you want to manage your database structure/migrations here?",
        name: 'withDb',
        default: true
      }
    ]).then(answers => baseProject(answers.dir, answers.repo, answers.withDb));
  });

const baseProject = (dir, repo, withDb) => {
  let {uid, gid} = os.userInfo(),
      cwd = process.cwd();
  proc.execSync(`
    docker run -u ${uid}:${gid} -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}
    sh -c 'mkdir -p ${dir} && wget -qO- ${repo} | tar xz -C ${dir} --strip-components=1'`);
  if(!withDb)
    proc.execSync(`
      docker run -u ${uid}:${gid} -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}
      sh -c 'rm -rf ${cwd}/${dir}/db && rm -rf ${cwd}/${dir}/tests/db && sed -i "/# This is the database/,/docker-entrypoint-initdb/d" docker-compose.yml && sed -i "/3000/,/db/{/3000/!d}" docker-compose.yml && sed -i "/db/d" docker-compose.yml'`);
}

program.parse(process.argv);
