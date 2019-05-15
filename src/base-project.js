#!/usr/bin/env node
"use strict";

import program from 'commander';
import proc from 'child_process';
import os from 'os';
import colors from 'colors';
import inquirer from 'inquirer';
import {notEmptyString} from './common.js';


import {
  DOCKER_APP_DIR,
  DOCKER_IMAGE,
  PLATFORM,
  DOCKER_HOST_OS
} from './env.js';

const baseProject = (dir, repo, withDb) => {
  const repo_archive = `https://github.com/subzerocloud/${repo}-starter-kit/archive/master.tar.gz`
  let u = "",
      cwd = process.cwd();
  if(PLATFORM == 'linux'){
    let {uid, gid} = os.userInfo();
    u = `-u ${uid}:${gid}`;
  }
  
  if(PLATFORM == 'win32'&& DOCKER_HOST_OS != "Docker for Windows"){
    // docker is running in virtualbox VM so we try to adjust the path to match the shared path
    cwd = '/' + cwd.replace(/([A-Z]):/,function(s){return s.toLocaleLowerCase().replace(':','')}).replace(/\\/g,'/')
  }
  console.log("Downloading the base project..");
  proc.execSync([
    `docker run ${u} --rm -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}`,
    `sh -c "mkdir -p ${dir} && wget -qO- ${repo_archive} | tar xz -C ${dir} --strip-components=1"`
  ].join(' '));
  if(!withDb){
    proc.execSync([
      `docker run ${u} --rm -v ${cwd}/:${DOCKER_APP_DIR} ${DOCKER_IMAGE}`,
      'sh -c "',
      [
        `cd ${DOCKER_APP_DIR}/${dir}`,
        'rm -rf db',
        'rm -rf tests/db/{rls,structure}.sql',
        'rm -rf tests/rest/{auth,common,read}.js',
        // Delete whole "db" component
        'sed -i \\"/### DB START/,/### DB END/d\\" docker-compose.yml',
        // Delete "links: - db:db" from postgrest
        'sed -i \\"/3000/,/db/{/3000/!d}\\" docker-compose.yml',
        // Delete all remaining "- db:db" lines
        'sed -i \\"/db/d\\" docker-compose.yml'
      ].join(" && "),
      '"'
    ].join(" "));
    console.log("Don't forget to edit the sample db connection details in the .env file".yellow);
  }
}



program
  .option("-d, --dir <dir>", "Directory where to initialize")
  .option("-k, --starter-kit <starter_kit>", "Starter Kit (postgrest or subzero)", /^(postgrest|subzero)$/i, undefined)
  .option("-m, --with-db", "Manage the database structure here")
  .action(async (options) => {
    let answers = await inquirer.prompt([
      {
        type: 'input',
        message: "Enter the directory path where you want to create the project",
        name: 'dir',
        default: '.',
        when: () => !options.dir,
        validate: val => notEmptyString(val)?true:"Please enter a dir"
      },
      {
        type: 'list',
        name: 'starterKit',
        message: 'Choose the starter kit',
        when: () => !['subzero','postgrest'].includes(options.starterKit),
        choices: [
          {
            name: 'postgrest-starter-kit (REST)',
            value: 'postgrest'
          },
          {
            name: 'subzero-starter-kit (REST & GraphQL)',
            value: 'subzero'
          }
        ]
      },
      {
        type: 'confirm',
        message: "Do you want to manage your database structure/migrations here?",
        name: 'withDb',
        when: () => options.withDb === undefined,
        default: true
      }
    ]);
    const dir = options.dir || answers.dir;
    const starter_kit = ['subzero','postgrest'].includes(options.starterKit) ? options.starterKit:answers.starterKit;
    const with_db = options.withDb || answers.withDb;

    baseProject(dir, starter_kit, with_db)
  });

  program.parse(process.argv);
