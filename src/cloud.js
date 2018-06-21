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
import {
  runCmd,
  checkOpenrestyInitiated,
  fileExists,
  dirExists,
  notEmptyString,
  checkIsAppDir,
  sqitchDeploy,
  checkMigrationsInitiated,
  checkPostgresConnection
} from './common.js';
import {
  APP_DIR,
  OPENRESTY_DIR,
  COMPOSE_PROJECT_NAME
} from './env.js';

import Table from 'tty-table';

const SERVER_URL = "https://api.subzero.cloud/rest";

const HOME_DIR = os.homedir();
const SUBZERO_DIR = `${HOME_DIR}/.subzero`
const SUBZERO_CREDENTIALS_FILE = `${SUBZERO_DIR}/credentials.json`;
const SUBZERO_APP_FILE = "./subzero-app.json";

const JWT_EXPIRED_ERROR = "JWT Expired".red + ", please login again with " + "`subzero cloud login`".white;

const login = (email, password) => {
  request
    .post(`${SERVER_URL}/rpc/login`)
    .send({"email": email, "password": password})
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
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
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok){
        console.log("Account created".green);
      }else
        console.log("%s".red, res.body.message);
    });
}

const createApplication = (token, app, cb) => {
  app.version = 'v0.0.0';
  let certificate_file = null,
      certificate_private_key_file = null;
  if(app.uploadCertificate){
    certificate_file = app.certificate_file;
    certificate_private_key_file = app.certificate_private_key_file;

    
    delete app['certificate_file'];
    delete app['certificate_private_key_file'];
    app.certificate_body = fs.readFileSync(certificate_file, 'utf8');
    app.certificate_private_key = fs.readFileSync(certificate_private_key_file, 'utf8');
  }
  delete app['uploadCertificate'];
  
  request
    .post(`${SERVER_URL}/applications?select=`
        [
          'id',
          'name',
          'domain',
          'openresty_repo',
          'db_service_host',
          'db_location',
          'db_admin',
          'db_host',
          'db_port',
          'db_name',
          'db_schema',
          'db_authenticator',
          'db_anon_role',
          'max_rows',
          'pre_request',
          'version',
          'openresty_image_type',
          'task_instances',
          'created_on',
          'updated_on'
        ].join(',')
    )
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok){
        let app_config = res.body;
        let id = app_config.id;
        if(certificate_file && certificate_file){
          app_config.certificate_file = certificate_file;
          app_config.certificate_private_key_file = certificate_private_key_file;
        }
        console.log(`Application ${id} created`.green);
        cb(app_config);
      }else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
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

const saveSubzeroAppConfig = app_config => fs.writeFileSync(SUBZERO_APP_FILE, JSON.stringify(app_config, null, 2));

const readSubzeroAppConfig = () => {
  if(!fileExists(SUBZERO_APP_FILE)){
    console.log("Error: ".red + `Couldn't find a ${SUBZERO_APP_FILE} file, did you create an application with` + " `subzero cloud create`?");
    process.exit(0);
  } else {
    try {
      return JSON.parse(fs.readFileSync(SUBZERO_APP_FILE, 'utf8'));
    } catch(e) {
      console.log("Error: ".red + `Invalid json in ${SUBZERO_APP_FILE}`);
      process.exit(0);
    }
  }
}

const readSubzeroAppId = () => {
  let conf = readSubzeroAppConfig();
  let id = conf.id;
  if(!id){
    console.log("Error: ".red + `No 'id' key in ${SUBZERO_APP_FILE}`);
    process.exit(0);
  }

  return id;
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
    .get(`${SERVER_URL}/applications?select=`
      [
        'id',
        'name',
        'domain',
        'openresty_repo',
        'db_service_host',
        'db_location',
        'db_admin',
        'db_host',
        'db_port',
        'db_name',
        'db_schema',
        'db_authenticator',
        'db_anon_role',
        'max_rows',
        'pre_request',
        'version',
        'openresty_image_type',
        'task_instances',
        'created_on',
        'updated_on'
      ].join(',')
    )
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        cb(res.body);
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
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
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        console.log("Application %s deleted".green, res.body.id);
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
        console.log("%s".red, res.body.message);
    });
}

const changeApplicationInstances = (id, token, num) => {
  request
    .post(`${SERVER_URL}/applications?select=id&id=eq.${id}`)
    .send({task_instances: num})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        console.log("Application %s is %s".green, res.body.id, (num == 0? 'stopping':'starting'));
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
        console.log("%s".red, res.body.message);
    });
}

const getApplication = (id, token, cb) => {
  request
    .get(`${SERVER_URL}/applications?id=eq.${id}&select=`
        [
          'id',
          'name',
          'domain',
          'openresty_repo',
          'db_service_host',
          'db_location',
          'db_admin',
          'db_host',
          'db_port',
          'db_name',
          'db_schema',
          'db_authenticator',
          'db_anon_role',
          'max_rows',
          'pre_request',
          'version',
          'openresty_image_type',
          'task_instances',
          'created_on',
          'updated_on'
        ].join(',')
    )
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        cb(res.body);
      else if(res.status == 406)
        console.log("No application with that id exists");
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
        console.log("%s".red, res.body.message);
    });
}

const deployApplication = async (appId, app_conf, db_admin, db_admin_pass, token, buildOpenresty, runSqitchMigrations, usingSubzeroCloudRegistry) => {
  let {host, port} = (() => {
    if(app_conf.db_location == 'container')
      return digSrv(app_conf.db_service_host);
    else
      return { host: app_conf.db_host, port: app_conf.db_port };
  })();
  let pg_host = host,
      pg_port = port,
      pg_user = db_admin || app_conf.db_admin,
      pg_pass = db_admin_pass;

  if(runSqitchMigrations){
    checkPostgresConnection(`postgres://${pg_user}@${pg_host}:${pg_port}/${app_conf.db_name}`, pg_pass);
  }

  if(buildOpenresty){
    console.log("Building and deploying openresty container");
    if(usingSubzeroCloudRegistry)
      await loginToDocker(token);
    runCmd("docker", ["build", "-t", "openresty", "./openresty"], {}, false, true);
    runCmd("docker", ["tag", "openresty", `${app_conf.openresty_repo}:${app_conf.version}`], {}, false, true);
    runCmd("docker", ["push", `${app_conf.openresty_repo}:${app_conf.version}`], {}, false, true);
  }
  else{
    console.log("Skipping OpenResty image building")
  }

  if(runSqitchMigrations){
    console.log("Deploying migrations with sqitch");
    migrationsDeploy(pg_user, pg_pass, pg_host, pg_port, app_conf.db_name);
  }
  else{
    console.log("Skipping database migration deploy")
  }

  if(usingSubzeroCloudRegistry){
    console.log(`Changing ${app_conf.name} application version to ${app_conf.version}`);
    updateApplication(appId, token, app_conf);
  }
}

const updateApplication = (id, token, app) => {
  delete app['id'];
  delete app['db_service_host'];
  delete app['openresty_repo'];
  if(app.certificate_file){
    app.certificate_body = fs.readFileSync(app.certificate_file, 'utf8');
    app.certificate_private_key = fs.readFileSync(app.certificate_private_key_file, 'utf8');
    delete app['certificate_file'];
    delete app['certificate_private_key_file'];
  }
  request
    .patch(`${SERVER_URL}/applications?select=id&id=eq.${id}`)
    .send({...app})
    .set("Authorization", `Bearer ${token}`)
    .set("Prefer", "return=representation")
    .set("Accept", "application/vnd.pgrst.object")
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        console.log("Application %s updated".green, res.body.id);
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
        console.log("%s".red, res.body.message);
    });
}

const loginToDocker = async (token) => {
  console.log("Logging in to registry.subzero.cloud");
  const res = await request
    .get(`${SERVER_URL}/rpc/get_docker_login`)
    .set("Authorization", `Bearer ${token}`);
  // if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
  if(res.ok){
    console.log(proc.execSync(res.text).toString('utf8').green);
  }else{
    console.log("%s".red, res.body.message);
    process.exit(0);
  }

}

const migrationsDeploy = (user, pass, host, port, db) => {
  sqitchDeploy(`db:pg://${user}:${pass}@${host}:${port}/${db}`);
}

const digSrv = (serviceHost, failOnError = true) => {
  try{
    let srv = proc.execSync(`dig +short srv ${serviceHost}`).toString('utf8').trim().split(" ");
    if(srv.length == 4)
      return {
        host : srv[3].slice(0, -1),
        port : srv[2]
      };
    else{
      if(failOnError){
        console.log(`Couldn't get SRV record from ${serviceHost}`.red);
        process.exit(0);
      }
    }
    
  }catch(e){
    if(failOnError){
      console.log(e.stdout.toString('utf8'));
      process.exit(0);
    }
  }

  return {
    host : '',
    port : ''
  };
}

const descriptions = {
  "id": "The subzero id of the application",
  "name": "The name you gave to your application",
  "db_location": "container: hosted by subzero, external: you are hosting the db yourself"
};

const printAppWithDescription = app => {
  let rows = [];
  if(app.db_location === 'container'){
    let db_host_port = digSrv(app.db_service_host, false);
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
        validate: val => validator.isUUID(val)?true:"Please enter a valid invite code"
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
        validate: val => validator.isEmail(val)?true:"Please enter a valid email"
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
program.command('login')
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
    if(fileExists(SUBZERO_APP_FILE)){
      console.log("Error: ".red + `There is a ${SUBZERO_APP_FILE} file already in place for this project`);
      process.exit(0);
    }
    checkIsAppDir();
    let token = readToken(),
        env = loadEnvFile();
    inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter your application name',
        default: COMPOSE_PROJECT_NAME,
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'input',
        name: 'domain',
        message: 'Enter your domain (ex: myapp.subzero.cloud or myappdomain.com)',
        validate: val => validator.isFQDN(val)?true:"Must be valid domain name"
      },
      {
        type: 'confirm',
        message: "Do you to enable SSL for your domain (you'll need your certificate and private key in PEM format)?",
        name: 'uploadCertificate',
        when: answers => !answers.domain.match(/^[a-z0-9]+\.subzero\.cloud$/)
      },
      // generate self signed with
      // openssl req -nodes -sha1 -x509 -newkey rsa:2048 -keyout key.pem -out certificate.pem -days 3650 -subj "/C=US/ST=Oregon/L=Portland/O=Company Name/OU=Org/CN=myappdomain.com"
      {
        type: 'input',
        message: "Enter the the path to your certificate file",
        name: 'certificate_file',
        default: 'certificate.pem',
        when: answers => answers.uploadCertificate,
        validate: val => (notEmptyString(val) && fileExists(val)) ? true : `Can not open file ${val}`
      },
      {
        type: 'input',
        message: "Enter the the path to your private key file",
        name: 'certificate_private_key_file',
        default: 'key.pem',
        when: answers => answers.uploadCertificate,
        validate: val => (notEmptyString(val) && fileExists(val)) ? true : `Can not open file ${val}`
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
        message: 'Enter the database administrator account password (8 chars minimum)',
        mask: '*',
        validate: val => {
          if(notEmptyString(val)){
            if(val.length >= 8)
              return true;
            else
              return "Must be 8 chars minimum";
          }else
            return "Cannot be empty";
        },
        when: answers => answers.db_location == "container"
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
        name: 'db_authenticator',
        message: 'Enter the db authenticator role',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_authenticator
      },
      {
        type: 'password',
        name: 'db_authenticator_pass',
        message: 'Enter the db authenticator role password (8 chars minimum)',
        mask: '*',
        when: answers => answers.db_location == "container",
        validate: val => {
          if(notEmptyString(val)){
            if(val.length >= 8)
              return true;
            else
              return "Must be 8 chars minimum";
          }else
            return "Cannot be empty";
        }
      },
      {
        type: 'password',
        name: 'db_authenticator_pass',
        message: 'Enter the db authenticator role password',
        mask: '*',
        when: answers => answers.db_location == "external",
        validate: (val, answers) => {
          if(notEmptyString(val)){
            let pg_host = answers.db_host,
                pg_port = answers.db_port,
                pg_user = answers.db_authenticator,
                pg_pass = val,
                pg_db_name = answers.db_name;
            return checkPostgresConnection(`postgres://${pg_user}@${pg_host}:${pg_port}/${pg_db_name}`, pg_pass, false);
          }else
            return "Cannot be empty";
        }
      },
      {
        type: 'input',
        name: 'db_schema',
        message: 'Enter the db schema exposed for API',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_schema
      },
      {
        type: 'input',
        name: 'db_anon_role',
        message: 'Enter the db anonymous role',
        validate: val => notEmptyString(val)?true:"Cannot be empty",
        default: env.db_anon_role
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
        type: 'confirm',
        message: "Use custom OpenRestyImage",
        name: 'openresty_image_type',
        default: fileExists(`${OPENRESTY_DIR}/Dockerfile`)
      }
    ]).then(answers => {

      answers.openresty_image_type = answers.openresty_image_type?'custom':'default';

      let app = answers;
      inquirer.prompt([
        {
          type: 'confirm',
          message: "Are you sure you want to create this application?",
          name: 'createIt'
        }
      ]).then(answers => {
        if(answers.createIt)
          createApplication(token, app, conf => saveSubzeroAppConfig(conf));
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
  .option("-a, --dba [dba]", "Database administrator account(only needed for external db)")
  .option("-p, --password [password]", "Database administrator account password")
  .description('Deploy a subzero application, this will run the latest migrations and push the latest openresty image')
  .action(options => {
    checkIsAppDir();
    const app_conf = readSubzeroAppConfig(),
          usingSubzeroCloudRegistry = app_conf.openresty_repo && app_conf.openresty_repo.startsWith("registry.subzero.cloud"),
          token = usingSubzeroCloudRegistry?readToken():null,
          appId = usingSubzeroCloudRegistry?readSubzeroAppId():null,
          runSqitchMigrations = dirExists(`${APP_DIR}/db`),
          buildOpenresty = !app_conf.openresty_image_type || app_conf.openresty_image_type === 'custom',
          dbIsExternal = app_conf.db_location == "external",
          {dba, password} = options,
          noOptionsSpecified = !dba && !password;
    if(runSqitchMigrations){
      checkMigrationsInitiated();
    }
    if(buildOpenresty){
      checkOpenrestyInitiated()
    }
    if(noOptionsSpecified){
      inquirer.prompt([
        {
          type: 'input',
          name: 'db_admin',
          message: "Enter the database administrator account",
          validate: val => notEmptyString(val)?true:"Cannot be empty",
          when: () => (dbIsExternal && runSqitchMigrations && !app_conf.db_admin),
        },
        {
          type: 'password',
          name: 'db_admin_pass',
          message: 'Enter the database administrator account password',
          mask: '*',
          when: () => runSqitchMigrations,
          validate: val => notEmptyString(val)?true:"Cannot be empty"
        }
      ]).then(answers => {
        deployApplication(appId, app_conf, answers.db_admin, answers.db_admin_pass, token, buildOpenresty, runSqitchMigrations, usingSubzeroCloudRegistry);
      });
    }else{
      if(dbIsExternal && !notEmptyString(dba))
        console.log("dba: cannot be empty");

      if(!notEmptyString(password))
        console.log("password: cannot be empty");
      else
        deployApplication(appId, app_conf, dba, password, token, buildOpenresty, runSqitchMigrations, usingSubzeroCloudRegistry);
  }
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
program.command('app-start')
  .description('Start a subzero application')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        id = readSubzeroAppId();
    changeApplicationInstances(id, token, 1);
  });
program.command('app-stop')
  .description('Stop a subzero application')
  .action(() => {
    checkIsAppDir();
    let token = readToken(),
        id = readSubzeroAppId();
    changeApplicationInstances(id, token, 0);
  });

program.parse(process.argv);
