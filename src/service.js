#!/usr/bin/env node
"use strict";

import os from 'os';
import fs from 'fs';
import program from 'commander';
import inquirer from 'inquirer';
import request from 'superagent';
import rimraf from 'rimraf';

const SERVER_URL = "http://localhost:3000";

const HOME_DIR = os.homedir();
const SUBZERO_DIR = `${HOME_DIR}/.subzero`
const SUBZERO_CREDENTIALS_FILE = "credentials.json"

const login = (username, password) => {
  request
    .post(`${SERVER_URL}/rpc/login`)
    .send({"email": username, "password": password})
    .end((err, res) => {
      if(res.ok){
        saveToken(res.body[0].token);
        console.log("\x1b[32m%s\x1b[0m", "Login succeeded");
      }else
        console.log("\x1b[31m%s\x1b[0m", res.body.message);
    });
}

const saveToken = token => {
  if(!fs.existsSync(SUBZERO_DIR))
    fs.mkdirSync(SUBZERO_DIR);
  fs.writeFileSync(`${SUBZERO_DIR}/${SUBZERO_CREDENTIALS_FILE}`,
                   `{ token: "${token}" }`);
}

program
  .command('login')
  .option("-u, --username [username]", "Your username")
  .option("-p, --password [password]", "Your password")
  .description('Login to subzero')
  .action(options => {
    const username = options.username;
    const password = options.password;
    if(!username && !password)
      inquirer.prompt([
        {
          type: 'input',
          message: "Enter your username",
          name: 'username',
          validate: val => notEmptyString(val)?true:"Please enter your username"
        },
        {
          type: 'password',
          message: 'Enter your password',
          name: 'password',
          mask: '*',
          validate: val => notEmptyString(val)?true:"Please enter your password"
        }
      ]).then(answers => login(answers.username, answers.password));
    else{
      if(!notEmptyString(username))
        console.log("username: cannot be empty");
      if(!notEmptyString(password))
        console.log("password: cannot be empty");
      if(notEmptyString(username) && notEmptyString(password))
        login(username, password);
    }
  });

// options.key returns bool if a value is not specified(e.g. subzero service login -u -p, options.{username,password} gives true), so make sure is a string
const notEmptyString = s => (typeof s == 'string')&&s.trim().length;

const logout = () => {
  if(fs.existsSync(SUBZERO_DIR)){
    rimraf.sync(SUBZERO_DIR);
    console.log("Removing subzero credentials");
  }else
    console.log("Not logged in to subzero");
}

program
  .command('logout')
  .description('Logout of subzero')
  .action(() => logout());

const signup = (name, email, password) => {
  request
    .post(`${SERVER_URL}/rpc/signup`)
    .send({"name": name, "email": email, "password": password})
  .end((err, res) => {
    if(res.ok){
        console.log("\x1b[32m%s\x1b[0m", "Account created");
      }else
        console.log("\x1b[31m%s\x1b[0m", res.body.message);
    });
}

program
  .command('signup')
  .description('Create your account on subzero')
  .action(() => {
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter your name",
        name: 'name',
        validate: val => notEmptyString(val)?true:"Please enter your name"
      },
      {
        type: 'input',
        message: "Enter your email",
        name: 'email',
        validate: val => notEmptyString(val)?true:"Please enter your email"
      },
      {
        type: 'password',
        message: 'Enter your password',
        name: 'password',
        mask: '*',
        validate: val => notEmptyString(val)?true:"Please enter your password"
      }
    ]).then(answers => signup(answers.name, answers.email, answers.password));
  });

program.parse(process.argv);
