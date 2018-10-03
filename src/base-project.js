#!/usr/bin/env node
"use strict";

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
      `sh -c "mkdir -p ${dir} && wget -qO- ${repo} | tar xz -C ${dir} --strip-components=1"`
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