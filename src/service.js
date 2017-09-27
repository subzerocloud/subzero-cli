#!/usr/bin/env node
"use strict";

import program from 'commander';
import inquirer from 'inquirer';

const login = (username, password) => {
  console.log("Welcome " + username);
}
program
  .command('login')
  .option("-u, --username [username]", "Your username")
  .option("-p, --password [password]", "Your password")
  .description('Login to subzero')
  .action(options => {
    if(!options.username && !options.password)
      inquirer.prompt([
        {
          type: 'input',
          message: "Enter your username",
          name: 'username'
        },
        {
          type: 'password',
          message: 'Enter a masked password',
          name: 'password',
          mask: '*'
        }
      ]).then(answers => login(answers.username, answers.password));
    else
      login(options.username, options.password);
  });

program.parse(process.argv);
