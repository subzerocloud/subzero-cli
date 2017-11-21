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
import {runCmd, fileExists, dirExists, notEmptyString, checkIsAppDir, sqitchDeploy, checkMigrationsInitiated} from './common.js';
import Table from 'tty-table';

const SERVER_URL = "https://api.subzero.cloud/rest";

const HOME_DIR = os.homedir();
const SUBZERO_DIR = `${HOME_DIR}/.subzero`
const SUBZERO_CREDENTIALS_FILE = `${SUBZERO_DIR}/credentials.json`;
const SUBZERO_APP_FILE = "./.subzero-app";

const login = (email, password) => {
  request
    .post(`${SERVER_URL}/rpc/login`)
    .send({"email": email, "password": password})
    .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok){
        saveToken(res.body[0].token);
        console.log("Login succeeded".green);
      }else
        console.log("%s".red, res.body.message);
    });
}

const saveToken = token => {
  if(!dirExists(SUBZERO_DIR))
    fs.mkdirSync(SUBZERO_DIR);
  fs.writeFileSync(SUBZERO_CREDENTIALS_FILE, `{ "token": "${token}" }`);
}

const logout = () => {
  if(dirExists(SUBZERO_DIR)){
    rimraf.sync(SUBZERO_DIR);
    console.log("Removing subzero credentials");
  }else
    console.log("Not logged in to subzero");
}

const signup = (name, email, password, invite) => {
  request
    .post(`${SERVER_URL}/rpc/signup`)
    .send({"name": name, "email": email, "password": password, "invite": invite})
  .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok){
        console.log("Account created".green);
      }else
        console.log("%s".red, res.body.message);
    });
}

const createApplication = (token, app, cb) => {
  app.version = 'v0.0.0';
  request
    .post(`${SERVER_URL}/applications?select=id`)
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok){
        let id = res.body.id;
        console.log(`Application ${id} created`.green);
        cb(id);
      }else
        console.log("%s".red, res.body.message);
    });
}

const readToken = () => {
  if(!fileExists(SUBZERO_CREDENTIALS_FILE)){
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

const saveSubzeroAppId = id => fs.writeFileSync(SUBZERO_APP_FILE, `{ "id": "${id}" }`);

const readSubzeroAppId = () => {
  if(!fileExists(SUBZERO_APP_FILE)){
    console.log("Error: ".red + "Couldn't find a .subzero-app file, did you create an application with `subzero cloud create`?");
    process.exit(0);
  } else {
    try {
      let id = JSON.parse(fs.readFileSync(SUBZERO_APP_FILE, 'utf8')).id;
      if(!id){
        console.log("Error: ".red + "No 'id' key in .subzero-app");
        process.exit(0);
      }else
        return id;
    } catch(e) {
      console.log("Error: ".red + "Invalid json in .subzero-app");
      process.exit(0);
    }
  }
}

// TODO! the info in in env contants
const loadEnvFile = () => {
  config({ path: ".env"});
  return {
    db_host: process.env.DB_HOST,
    db_port: process.env.DB_PORT,
    db_name: process.env.DB_NAME,
    db_schema: process.env.DB_SCHEMA,
    db_authenticator: process.env.DB_USER,
    db_anon_role: process.env.DB_ANON_ROLE,
    db_admin: process.env.SUPER_USER,
  };
}

const listApplications = (token, cb) => {
  request
    .get(`${SERVER_URL}/applications?select=id,db_admin,db_anon_role,db_authenticator,db_host,db_location,db_name,db_port,db_service_host,db_schema,openresty_repo,domain,max_rows,name,pre_request,version`)
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok){
        cb(res.body);
      }else
        console.log("%s".red, res.body.message);
    });
}

const printApps = apps => {
  let rows = [];
  apps.map(x => rows.push([x.id, x.name, x.domain]));
  let table = new Table([
    { value: "Id", width: 40, align: 'left', headerAlign: 'left' },
    { value: "Name", width: 40, align: 'left', headerAlign: 'left'},
    { value: "Domain", width: 40, align: 'left', headerAlign: 'left'}
  ], rows, {borderStyle: 0, compact: true});
  console.log(table.render().toString());
}

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
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok)
        cb(res.body);
      else if(res.status == 406)
        console.log("No application with that id exists");
      else
        console.log("%s".red, res.body.message);
    });
}

const updateApplication = (id, token, app) => {
  request
    .patch(`${SERVER_URL}/applications?select=id&id=eq.${id}`)
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
      if(res.ok){
        console.log("Application %s updated".green, res.body.id);
      }else
        console.log("%s".red, res.body.message);
    });
}

const getDockerLogin = (token, cb) => {
  request
    .get(`${SERVER_URL}/rpc/get_docker_login`)
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(err){
        console.log("%s".red, err.toString());
        return;
      }
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
  sqitchDeploy(`db:pg://${user}:${pass}@${host}:${port}/${db}`);
}

const digSrv = serviceHost => {
  try{
    let srv = proc.execSync(`dig +short srv ${serviceHost}`).toString('utf8').trim().split(" ");
    if(srv.length == 4)
      return {
        host : srv[3].slice(0, -1),
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

const descriptions = {
  "id": "The subzero id of the application",
  "name": "The name you gave to your application",
  "db_location": "container: hosted by subzero, external: you are hosting the db yourself"
};

const printAppWithDescription = app => {
  let rows = [];
  if(app.db_location === 'container'){
    let db_host_port = digSrv(app.db_service_host);
    app.db_host = db_host_port.host;
    app.db_port = db_host_port.port;
  }
  Object.keys(app).map( x => rows.push([ x, app[x] + "\n" + (descriptions[x]||'')]));
  let table = new Table([
      { value: "Property", align: 'left', headerAlign: 'left' },
      { value: "Value", width: 80, align: 'left', headerAlign: 'left'}
  ], rows, { defaultValue: "", borderStyle: 0, compact: true});
  console.log(table.render().toString());
}

program.command('signup')
  .description('Create your account on subzero')
  .action(() => {
    inquirer.prompt([
      {
        type: 'input',
        message: "Enter your invite code",
        name: 'invite',
        validate: val => notEmptyString(val)?true:"Please enter your invite code"
      },
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
    ]).then(answers => signup(answers.name, answers.email, answers.password, answers.invite));
  });
program .command('login')
  .option("-e, --email [email]", "Your email")
  .option("-p, --password [password]", "Your password")
  .description('Login to subzero')
  .action(options => {
    const email = options.email;
    const password = options.password;
    if(!email && !password)
      inquirer.prompt([
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
      ]).then(answers => login(answers.email, answers.password));
    else{
      if(!notEmptyString(email))
        console.log("email: cannot be empty");
      if(!notEmptyString(password))
        console.log("password: cannot be empty");
      if(notEmptyString(email) && notEmptyString(password))
        login(email, password);
    }
  });
program.command('logout')
  .description('Logout from subzero')
  .action(() => logout());
program.command('list')
  .description('List your applications on subzero')
  .action(() => listApplications(readToken(), apps => {
    printApps(apps);
  }));
program.command('app-create')
  .description('Create an application on subzero')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        env = loadEnvFile();
    inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter your application name',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'input',
        name: 'domain',
        message: 'Enter your domain (ex: myapp.subzero.cloud)',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'list',
        name: 'db_location',
        message: "Would you like subzero to create a database for you?",
        choices: [
          {
            name: 'Yes (db running in container, for light use)',
            value: 'container'
          },
          {
            name: "No, I'll provide my own database (recommened RDS in us-east-1)",
            value: 'external'
          }
        ]
      },
      {
        type: 'input',
        name: 'db_admin',
        message: 'Enter the database administrator account',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_admin,
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
        type: 'password',
        name: 'jwt_secret',
        message: 'Enter your jwt secret (32 chars minimum)',
        validate: val => {
          if(notEmptyString(val)){
            if(val.length >= 32)
              return true;
            else
              return "Must be 32 chars minimum";
          }else
            return "Cannot be empty";
        },
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
          createApplication(token, app, id => saveSubzeroAppId(id));
        else
          console.log("No application created");
      });
    });
  });
program.command('app-delete')
  .description('Delete a subzero application')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        id = readSubzeroAppId();
    
    getApplication(id, token, app => {
      printAppWithDescription(app);
      if(app.db_location == "container")
        console.log("\nWarning: this will also delete the database".yellow);
      inquirer.prompt([
        {
          type: 'confirm',
          message: "Are you sure you want to delete this application?",
          name: 'deleteIt',
          default: false
        }
      ]).then(answers => {
        if(answers.deleteIt){
          deleteApplication(id, token);
          fs.unlinkSync(SUBZERO_APP_FILE);
        }
        else{
          console.log("No application deleted");
        }
      });
    });
  });
program.command('app-deploy')
  .description('Deploy a subzero application, this will run the latest migrations and push the latest openresty image')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        appId = readSubzeroAppId();
    checkMigrationsInitiated();
    getApplication(appId, token, app => {
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
          message: 'Enter the new version of the application (ex: v0.1.0)',
          validate: val => notEmptyString(val)?true:"Cannot be empty"
        }
      ]).then(answers => {
        getDockerLogin(token, () => {
          runCmd("docker", ["build", "-t", "openresty", "./openresty"]);
          runCmd("docker", ["tag", "openresty", `${app.openresty_repo}:${answers.version}`]);
          runCmd("docker", ["push", `${app.openresty_repo}:${answers.version}`]);
          let {host, port} = (() => {
            if(app.db_location == 'container')
              return digSrv(app.db_service_host);
            else
              return { host: app.db_host, port: app.db_port };
          })();
          migrationsDeploy(answers.db_admin || app.db_admin, answers.db_admin_pass, host, port, app.db_name);
          updateApplication(appId, token, { version: answers.version });
        });
      });
    });
  });

program.command('app-status')
  .description('Show status and properties of a subzero application')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        id = readSubzeroAppId();
    getApplication(id, token, app => {
      printAppWithDescription(app);
    });
  });
program.parse(process.argv);
