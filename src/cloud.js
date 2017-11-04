#!/usr/bin/env node
"use strict";

import os from 'os';
import fs from 'fs';
import program from 'commander';
import inquirer from 'inquirer';
import request from 'superagent';
import rimraf from 'rimraf';
import colors from 'colors';
import {highlight} from 'cli-highlight';
import validator from 'validator';
import {config} from 'dotenv';
import proc from 'child_process';
import {runCmd} from './common.js';

const SERVER_URL = "https://api.subzero.cloud/rest";

const HOME_DIR = os.homedir();
const SUBZERO_DIR = `${HOME_DIR}/.subzero`
const SUBZERO_CREDENTIALS_FILE = `${SUBZERO_DIR}/credentials.json`;

const login = (username, password) => {
  request
    .post(`${SERVER_URL}/rpc/login`)
    .send({"email": username, "password": password})
    .end((err, res) => {
      if(res.ok){
        saveToken(res.body[0].token);
        console.log("Login succeeded".green);
      }else
        console.log("%s".red, res.body.message);
    });
}

const saveToken = token => {
  if(!fs.existsSync(SUBZERO_DIR))
    fs.mkdirSync(SUBZERO_DIR);
  fs.writeFileSync(SUBZERO_CREDENTIALS_FILE,
                   `{ "token": "${token}" }`);
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
        console.log("Account created".green);
      }else
        console.log("%s".red, res.body.message);
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


const createApplication = (token, app) => {
  request
    .post(`${SERVER_URL}/applications?select=id`)
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(res.ok){
        console.log(`Application ${res.body.id} created`.green);
      } else
        console.log("%s".red, res.body.message);
    });
}

const readToken = () => {
  if (!fs.existsSync(SUBZERO_CREDENTIALS_FILE) || !fs.statSync(SUBZERO_CREDENTIALS_FILE).isFile()){
    console.log("Error: ".red + "You need to be logged in to make this operation, please run " + "'subzero cloud login'".white);
    process.exit(0);
  } else {
    try {
      let token = JSON.parse(fs.readFileSync(SUBZERO_CREDENTIALS_FILE, 'utf8')).token;
      if(!token){
        console.log("Error: ".red + "No 'token' key in .subzero/credentials.json, please try to login again");
        process.exit(0);
      } else
        return token;
    } catch(e) {
      console.log("Error: ".red + "Invalid json in .subzero/credentials.json, please try to login again");
      process.exit(0);
    }
  }
}

const loadEnvFile = () => {
  config({ path: ".env"});
  return {
    db_host: process.env.DB_HOST,
    db_port: process.env.DB_PORT,
    db_name: process.env.DB_NAME,
    db_schema: process.env.DB_SCHEMA,
    db_authenticator: process.env.DB_USER,
    db_anon_role: process.env.DB_ANON_ROLE
  };
}

program
  .command('create')
  .description('Create an application on subzero')
  .action(() => {
    let token = readToken(),
        env = loadEnvFile();
    inquirer.prompt([
      {
        type: 'list',
        name: 'db_location',
        message: "Would you like subzero to create a database for you?",
        choices: [
          {
            name: 'Yes',
            value: 'container'
          },
          {
            name: "No, I'll provide my own database",
            value: 'external'
          }
        ]
      },
      {
        type: 'input',
        name: 'db_admin',
        message: 'Enter the database administrator account',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        when: answers => answers.db_location == "container"
      },
      {
        type: 'password',
        name: 'db_admin_pass',
        message: 'Enter the database administrator account password',
        mask: '*',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        when: answers => answers.db_location == "container"
      },
      {
        type: 'input',
        name: 'name',
        message: 'Enter your application name',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'input',
        name: 'domain',
        message: 'Enter your domain',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'password',
        name: 'jwt_secret',
        message: 'Enter your jwt secret',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        mask : '*'
      },
      {
        type: 'input',
        name: 'db_host',
        message: 'Enter the db host',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_host,
        when: answers => answers.db_location == "external"
      },
      {
        type: 'input',
        name: 'db_port',
        message: 'Enter the db port',
        validate: val => {
          if(isNaN(val))
            return "Must be a number";
          else if(!(1024 < parseInt(val) && parseInt(val) < 65535))
            return "Must be a valid port number";
          else
            return true;
        },
        default: env.db_port,
        when: answers => answers.db_location == "external"
      },
      {
        type: 'input',
        name: 'db_name',
        message: 'Enter the db name',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_name
      },
      {
        type: 'input',
        name: 'db_schema',
        message: 'Enter the db schema',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_schema
      },
      {
        type: 'input',
        name: 'db_authenticator',
        message: 'Enter the db authenticator role',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_authenticator
      },
      {
        type: 'password',
        name: 'db_authenticator_pass',
        message: 'Enter the db authenticator role password',
        mask: '*',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'input',
        name: 'db_anon_role',
        message: 'Enter the db anonymous role',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_anon_role
      },
      {
        type: 'input',
        name: 'version',
        message: 'Enter your application version',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      }
    ]).then(answers => {
      let app = answers;
      inquirer.prompt([
        {
          type: 'confirm',
          message: "Are you sure you want to create this application?",
          name: 'createIt'
        }
      ]).then(answers => {
        if(answers.createIt)
          createApplication(token, app);
        else
          console.log("No application created");
      });
    });
  });

const listApplications = token => {
  request
    .get(`${SERVER_URL}/applications?select=id,db_admin,db_anon_role,db_authenticator,db_host,db_location,db_name,db_port,db_service_host,db_schema,openresty_repo,domain,max_rows,name,pre_request,version`)
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(res.ok)
        console.log(highlight(JSON.stringify(res.body, null, 4), {language : 'json'}));
      else
        console.log("%s".red, res.body.message);
    });
}

program
  .command('list')
  .description('List your applications on subzero')
  .action(() => listApplications(readToken()));

const deleteApplication = (id, token) => {
  request
    .delete(`${SERVER_URL}/applications?select=id&id=eq.${id}`)
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(res.ok)
        console.log("Application %s deleted".green, res.body.id);
      else
        console.log("%s".red, res.body.message);
    });
}

const getApplication = (id, token, cb) => {
  request
    .get(`${SERVER_URL}/applications?id=eq.${id}&select=id,db_admin,db_anon_role,db_authenticator,db_host,db_location,db_name,db_port,db_service_host,db_schema,openresty_repo,domain,max_rows,name,pre_request,version`)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(res.ok)
        cb(res.body);
      else if(res.status == 406)
        console.log("No application with that id exists");
      else
        console.log("%s".red, res.body.message);
    });
}

program
  .command('delete')
  .description('Delete a subzero application')
  .action(() => {
    let token = readToken();
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter the application id",
        name: 'id',
        validate: val => {
          if(!notEmptyString(val))
            return "Please enter the application id";
          else if(!validator.isUUID(val))
            return "Please enter a valid id";
          else
            return true;
        }
      }
    ]).then(answers => {
      let id = answers.id;
      getApplication(id, token, app => {
        console.log(highlight(JSON.stringify(app, null, 4), {language : 'json'}));
        if(app.db_location == "container")
          console.log("\nWarning: this will also delete the database".yellow);
        inquirer.prompt([
          {
            type: 'confirm',
            message: "Are you sure you want to delete this application?",
            name: 'deleteIt'
          }
        ]).then(answers => {
          if(answers.deleteIt)
            deleteApplication(id, token);
          else
            console.log("No application deleted");
        });
      });
    });
  });

const updateApplication = (id, token, app) => {
  request
    .patch(`${SERVER_URL}/applications?select=id&id=eq.${id}`)
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(res.ok)
        console.log("Application %s updated".green, res.body.id);
      else
        console.log("%s".red, res.body.message);
    });
}

program
  .command('update')
  .description('Update a subzero application')
  .action(() => {
    let token = readToken();
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter the application id",
        name: 'id',
        validate: val => {
          if(!notEmptyString(val))
            return "Please enter the application id";
          else if(!validator.isUUID(val))
            return "Please enter a valid id";
          else
            return true;
        }
      }
    ]).then(answers => {
      let id = answers.id;
      getApplication(id, token, previousApp => {
        inquirer.prompt([
          {
            type: 'input',
            name: 'db_admin',
            message: "Enter the new database administrator account",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            when: () => previousApp.db_location == "container",
            default: previousApp.db_admin
          },
          {
            type: 'password',
            name: 'db_admin_pass',
            message: 'Enter the new database administrator account password',
            mask: '*',
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            when: () => previousApp.db_location == "container"
          },
          {
            type: 'input',
            name: 'name',
            message: "Enter the new application name",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.name
          },
          {
            type: 'input',
            name: 'domain',
            message: "Enter the new domain",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.domain
          },
          {
            type: 'password',
            name: 'jwt_secret',
            message: 'Enter the new jwt secret',
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            mask: '*'
          },
          {
            type: 'input',
            name: 'db_host',
            message: "Enter the new db host",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.db_host,
            when: () => previousApp.db_location == "external"
          },
          {
            type: 'input',
            name: 'db_port',
            message: "Enter the new db port",
            validate: val => {
              if(isNaN(val))
                return "Must be a number";
              else if(!(1024 < parseInt(val) && parseInt(val) < 65535))
                return "Must be a valid port number";
              else
                return true;
            },
            default: previousApp.db_port,
            when: () => previousApp.db_location == "external"
          },
          {
            type: 'input',
            name: 'db_name',
            message: "Enter the new db name",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.db_name
          },
          {
            type: 'input',
            name: 'db_schema',
            message: "Enter the new db schema",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.db_schema
          },
          {
            type: 'input',
            name: 'db_authenticator',
            message: "Enter the new db authenticator role",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.db_authenticator
          },
          {
            type: 'password',
            name: 'db_authenticator_pass',
            message: 'Enter the new db authenticator role password',
            mask: '*',
            validate: val => notEmptyString(val)?true:"Cannot be empty"
          },
          {
            type: 'input',
            name: 'db_anon_role',
            message: "Enter the new db anonymous role",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.db_anon_role
          },
          {
            type: 'input',
            name: 'version',
            message: "Enter the new application version",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            default: previousApp.version
          }
        ]).then(answers => {
          let app = answers;
          inquirer.prompt([
            {
              type: 'confirm',
              message: "Are you sure you want to update this application?",
              name: 'updateIt'
            }
          ]).then(answers => {
            if(answers.updateIt)
              updateApplication(id, token, app);
            else
              console.log("No application updated");
          });
        });
      });
    });
  });

const getDockerLogin = (token, cb) => {
  request
    .get(`${SERVER_URL}/rpc/get_docker_login`)
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(res.ok){
        console.log("Logging in to subzero.cloud docker registry..");
        console.log(proc.execSync(res.text).toString('utf8').green);
        cb();
      }else{
        console.log("%s".red, res.body.message);
        process.exit(0);
      }
    });
}

const migrationsDeploy = (user, pass, host, port, db) => {
  try{
    console.log(proc.execSync(`subzero migrations deploy db:pg://${user}:${pass}@${host}:${port}/${db}`).toString('utf8'));
  }catch(e){
    console.log(e.stdout.toString('utf8'));
    process.exit(0);
  }
}

const digSrv = serviceHost => {
  try{
    let srv = proc.execSync(`dig +short srv ${serviceHost}`).toString('utf8').trim().split(" ");
    if(srv.length == 4)
      return {
        host : srv[3],
        port : srv[2]
      };
    else{
      console.log(`Couldn't get SRV record from ${serviceHost}`.red);
      process.exit(0);
    }
  }catch(e){
    console.log(e.stdout.toString('utf8'));
    process.exit(0);
  }
}

program
  .command('deploy')
  .description('Deploy a subzero application, this will run the latest migrations and push the latest openresty image')
  .action(() => {
    let token = readToken();
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter the application id",
        name: 'id',
        validate: val => {
          if(!notEmptyString(val))
            return "Please enter the application id";
          else if(!validator.isUUID(val))
            return "Please enter a valid id";
          else
            return true;
        }
      }
    ]).then(answers => {
      let idToUpdate = answers.id;
      getApplication(idToUpdate, token, app => {
        inquirer.prompt([
          {
            type: 'input',
            name: 'db_admin',
            message: "Enter the database administrator account",
            validate: val => notEmptyString(val)?true:"Cannot be empty",
            when: () => app.db_location == "external",
          },
          {
            type: 'password',
            name: 'db_admin_pass',
            message: 'Enter the database administrator account password',
            mask: '*',
            validate: val => notEmptyString(val)?true:"Cannot be empty"
          },
          {
            type: 'input',
            name: 'version',
            message: 'Enter the new version of the application',
            validate: val => notEmptyString(val)?true:"Cannot be empty"
          }
        ]).then(answers => {
          let {host, port} = digSrv(app.db_service_host);
          migrationsDeploy(answers.db_admin || app.db_admin, answers.db_admin_pass, host, port, app.db_name);
          getDockerLogin(token, () => {
            runCmd("docker", ["build", "-t", "openresty", "./openresty"]);
            runCmd("docker", ["tag", "openresty", `${app.openresty_repo}:${answers.version}`]);
            runCmd("docker", ["push", `${app.openresty_repo}:${answers.version}`]);
            updateApplication(idToUpdate, token, { version: answers.version });
          });
        });
      });
    });
  });

program.parse(process.argv);
