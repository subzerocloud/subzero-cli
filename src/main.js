#!/usr/bin/env node
"use strict";

import readline from 'readline';
import os from 'os';
import program from 'commander';
import {version} from '../package.json';
import proc from 'child_process';
import inquirer from 'inquirer';
import {notEmptyString, checkIsAppDir} from './common.js';
import colors from 'colors';
import {
  DOCKER_IMAGE,
  DOCKER_APP_DIR,
  WATCH_PATTERNS,
  APP_DIR
} from './env.js';
import {resetDb, runWatcher, dockerContainers} from './watch.js';

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
  console.log("Downloading the base project..");
  proc.execSync(`
    docker run -u ${uid}:${gid} -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}
    sh -c 'mkdir -p ${dir} && wget -qO- ${repo} | tar xz -C ${dir} --strip-components=1'`);
  if(!withDb){
    proc.execSync(`
      docker run -u ${uid}:${gid} -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}
      sh -c '${
        `rm -rf ${cwd}/${dir}/db && ` +
        `rm -rf ${cwd}/${dir}/tests/db/{rls,structure}.sql && rm -rf ${cwd}/${dir}/tests/rest/{auth,common,read}.js && ` +
        // Delete whole "db" component
        `sed -i "/### DB START/,/### DB END/d" docker-compose.yml && ` +
        // Delete "links: - db:db" from postgrest
        `sed -i "/3000/,/db/{/3000/!d}" docker-compose.yml && ` +
        // Delete all remaining "- db:db" lines
        `sed -i "/db/d" docker-compose.yml`
      }'`);
    console.log("Don't forget to edit the sample db connection details in the .env file".yellow);
  }
}

program
  .command('watch')
  .description('Live code reloading for SQL/Lua/Nginx configs')
  .action(() => {
    checkIsAppDir();
    console.log("You can reset the db by pressing the 'r' button\n".white);

    const watcherReady = () => {
      console.log('Watching ' + WATCH_PATTERNS.map(p => p.replace(APP_DIR + '/','')).join(', ') + ` in ${APP_DIR} for changes.`);
    }
    const reloadStart = relPath => {
      console.log(`\n${relPath} changed`);
      console.log('Starting code reload..');
    }
    const reloadEnd = () => {
      console.log('Reload done');
    }

    const containers = dockerContainers();
    const watcher = runWatcher(containers, console, watcherReady, reloadStart, reloadEnd);

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on('keypress', (str, key) => {
      if(key.name === "c" && key.ctrl)
        process.exit();

      if(key.name === "r") {
        console.log("\nResetting the db..");
        resetDb(containers, console).on('close', () => console.log("Db reset done"));
      }
    });

    process.on('exit', () => watcher.close());
  });

program.parse(process.argv);
