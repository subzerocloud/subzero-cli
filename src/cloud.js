#!/usr/bin/env node
"use strict";

import os from 'os';
import fs from 'fs';
import program from 'commander';
import inquirer from 'inquirer';
import request from 'superagent';
import cookie  from 'cookie';
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
  COMPOSE_PROJECT_NAME,
  MIGRATIONS_DIR
} from './env.js';

import Table from 'tty-table';

const SERVER_URL = "https://api.subzero.cloud/rest";

const HOME_DIR = os.homedir();
const SUBZERO_DIR = `${HOME_DIR}/.subzero`
const SUBZERO_TOKEN_FILE = `${SUBZERO_DIR}/token.json`;
const SUBZERO_APP_FILE = "./subzero-app.json";

const JWT_EXPIRED_ERROR = "Login token Expired".red + ", please login again with " + "`subzero cloud login`".white;

const login = (email, password) => {
  request
    .post(`${SERVER_URL}/rpc/login`)
    .send({"email": email, "password": password})
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok){
        const cookies = cookie.parse(res.headers['set-cookie'][0] || '')
        saveToken(cookies.SESSIONID);
        console.log("Login succeeded".green);
      }else
        printApiError(res.body);
    });
}

const saveToken = token => {
  if(!dirExists(SUBZERO_DIR))
    fs.mkdirSync(SUBZERO_DIR);
  fs.writeFileSync(SUBZERO_TOKEN_FILE, `{ "token": "${token}" }`);
}

const logout = () => {
  if(fileExists(SUBZERO_TOKEN_FILE)){
    fs.unlinkSync(SUBZERO_TOKEN_FILE);
    console.log("Removing subzero credentials");
  }else
    console.log("Not logged in to subzero");
}

const readToken = () => {
  if(!fileExists(SUBZERO_TOKEN_FILE)){
    console.log("Error: ".red + "You need to be logged in to perform this action, please run " + "'subzero cloud login'".white);
    process.exit(0);
  } else {
    try {
      let token = JSON.parse(fs.readFileSync(SUBZERO_TOKEN_FILE, 'utf8')).token;
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

const saveSubzeroAppConfig = app => {
  fs.writeFileSync(SUBZERO_APP_FILE, getApplicationConfig(app));
}

const readSubzeroAppConfig = () => {
  if(!fileExists(SUBZERO_APP_FILE)){
    console.log("Error: ".red + `Couldn't find a ${SUBZERO_APP_FILE} file`);
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

const listApplications = (token, cb) => {
  request
    .get(`${SERVER_URL}/applications?select=` +
      [
        'status',
        'id',
        'name',
        'domain',
        'openresty_repo',
        'db_host',
        'db_port',
        'db_name',
        'db_schema',
        'db_authenticator',
        'db_anon_role',
        'max_rows',
        'pre_request',
        'openresty_image_tag',
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
        printApiError(res.body);
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

const getApplication = async (id, token, cb) => {
  let res = null
  try {
    res = await request
      .get(`${SERVER_URL}/applications?id=eq.${id}&select=` +
          [
            'id',
            'status',
            'name',
            'domain',
            'openresty_repo',
            'db_host',
            'db_port',
            'db_name',
            'db_schema',
            'db_authenticator',
            'db_anon_role',
            'max_rows',
            'pre_request',
            'openresty_image_tag',
            'task_instances',
            'created_on',
            'updated_on'
          ].join(',')
      )
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/vnd.pgrst.object");

    //console.log(res.body)
    if(res.ok){
      if(cb) { cb(res.body) }
      else { return res.body }
    }
    
  } catch (err) {
    //console.log(res)
    if(err.status == 406)
      console.log("No application with that id exists");
    else if(err.status == 401)
      console.log(JWT_EXPIRED_ERROR);
    else
      printApiError(err.response.body);
  }
  
   
      
  
  
  return null;
}

const reloadDatabaseSchema = (id, token) => {
  request
    .get(`${SERVER_URL}/rpc/reload_db_schema?id=eq.${id}`)
    .set("Authorization", `Bearer ${token}`)
    .end((err, res) => {
      if(err && typeof res == 'undefined'){console.log("%s".red, err.toString());return;}
      if(res.ok)
        console.log("Database schema reloaded".green);
      else if(res.status == 406)
        console.log("No application with that id exists");
      else if(res.status == 401)
        console.log(JWT_EXPIRED_ERROR);
      else
        printApiError(res.body);
    });
}

const deployApplication = async (options) => {

  const app_conf = readSubzeroAppConfig(),
        isSubzeroCloudApp = app_conf.id !== undefined,
        token = isSubzeroCloudApp?readToken():null,
        runSqitchMigrations = dirExists(MIGRATIONS_DIR),
        openresty_image_tag = options.openrestyImageTag,
        buildOpenresty = dirExists(OPENRESTY_DIR) && app_conf.openresty_repo && openresty_image_tag,
        appId = isSubzeroCloudApp?app_conf.id:null;

  let   {dba, password} = options,
        noOptionsSpecified = !dba || !password;

  if(isSubzeroCloudApp){
    const a = await getApplication(appId, token);
    if(a.status !== 'ready'){
      console.log("You can deploy only when the application status is 'ready'")
      console.log(`Current application status: ${a.status}`.red)
      process.exit(0);
    }
  }
  if(runSqitchMigrations){
    checkMigrationsInitiated();
  }
  if(buildOpenresty){
    checkOpenrestyInitiated()
  }
  if(runSqitchMigrations && noOptionsSpecified){
    let answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'dba',
        message: "Enter the database administrator account",
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      },
      {
        type: 'password',
        name: 'password',
        message: 'Enter the database administrator account password',
        mask: '*',
        validate: val => notEmptyString(val)?true:"Cannot be empty"
      }
    ]);
    dba = answers.dba;
    password = answers.password;
    
  }

  if ( runSqitchMigrations ){
    if(!notEmptyString(dba) || !notEmptyString(password)){
      console.log("dba/password: cannot be empty");
      return
    }
  }

  let pg_host = app_conf.db_host,
      pg_port = app_conf.db_port,
      pg_user = dba,
      pg_pass = password

  if(runSqitchMigrations){
    checkPostgresConnection(`postgres://${pg_user}@${pg_host}:${pg_port}/${app_conf.db_name}`, pg_pass);
  }

  if(buildOpenresty){
    console.log("Building openresty container image" );
    if(isSubzeroCloudApp){
      await loginToDocker(token);
    }
    runCmd("docker", ["build", "-t", `${COMPOSE_PROJECT_NAME}/openresty:${openresty_image_tag}`, "./openresty"], {}, false, true);
    runCmd("docker", ["tag", `${COMPOSE_PROJECT_NAME}/openresty:${openresty_image_tag}`, `${app_conf.openresty_repo}:${openresty_image_tag}`], {}, false, true);
  }
  else{
    console.log("Skipping OpenResty image building:")
    if(!dirExists(OPENRESTY_DIR)){
      console.log(`\t${OPENRESTY_DIR} folder does not exist`)
    }
    if(!app_conf.openresty_repo){
      console.log(`\t'openresty_repo' field not set in ${SUBZERO_APP_FILE}`)
    }
    
    if(!openresty_image_tag){
      console.log('\t--openresty-image-tag flag not set')
    }
  }

  if(runSqitchMigrations){
    console.log("Deploying database migrations with sqitch");
    migrationsDeploy(pg_user, pg_pass, pg_host, pg_port, app_conf.db_name);
  }
  else{
    console.log("Skipping database migrations deploy:")
    console.log(`\t${MIGRATIONS_DIR} folder does not exist`)
  }

  if(buildOpenresty){
    console.log("Pushing openresty container image to:\n" + app_conf.openresty_repo );
    runCmd("docker", ["push", `${app_conf.openresty_repo}:${openresty_image_tag}`], {}, false, true);
  }
  if(isSubzeroCloudApp){
    console.log(`Deploying ${app_conf.name} application to subzero.cloud`);
    if(openresty_image_tag){
      app_conf['openresty_image_tag'] = openresty_image_tag;
      saveSubzeroAppConfig(app_conf);
    }
    updateApplication(appId, token, app_conf);
  }
  else {
    console.log("All application components have been deployed")
    console.log("You should restart your production contianers now")
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
        printApiError(res.body);
    });
}

const printApiError = (err) => {
  console.log(
    "%s\n%s\n%s".red, 
    err.message?err.message:'',
    err.hint?err.hint:'',
    err.details?err.details:'',
    );
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
    printApiError(res.body);
    process.exit(0);
  }

}

const getApplicationId = async () => {
  let id =  fileExists(SUBZERO_APP_FILE) ? readSubzeroAppId() : null;
  if(!id){
    const answers = await inquirer.prompt([
      {
        type: 'input',
        message: "Application id",
        name: 'id',
        validate: val => notEmptyString(val)?true:"Application id can not be an empty string"
      }
    ]);
    id = answers.id
  }
  return id
}

const migrationsDeploy = (user, pass, host, port, db) => {
  sqitchDeploy(`db:pg://${user}:${pass}@${host}:${port}/${db}`);
}

const descriptions = {
  "id": "The subzero id of the application",
  "name": "The name you gave to your application",
  "db_location": "container: hosted by subzero, external: you are hosting the db yourself"
};

const printAppWithDescription = app => {
  let rows = [];
  Object.keys(app).map( x => rows.push([ x, app[x] + "\n" + (descriptions[x]||'').grey]));
  let table = new Table([
      { value: "Property", align: 'left', headerAlign: 'left' },
      { value: "Value", width: 80, align: 'left', headerAlign: 'left'}
  ], rows, { defaultValue: "", borderStyle: 0, compact: true});
  console.log(table.render().toString());
}

const getApplicationConfig = app => {
  delete app['status'];
  delete app['task_instances'];
  delete app['created_on'];
  delete app['updated_on'];
  return JSON.stringify(app, null, 4);
}

program.command('login')
  .option("-e, --email <email>", "Your email (or set SUBZERO_EMAIL env var)")
  .option("-p, --password <password>", "Your password (or set SUBZERO_PASSWORD env var)")
  .description('Login to subzero')
  .action(options => {
    const email = options.email || process.env.SUBZERO_EMAIL;
    const password = options.password || process.env.SUBZERO_PASSWORD;
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

program.command('get-docker-login')
  .description('authenticate your Docker client to subzero registry')
  .action(() => loginToDocker(readToken()));

program.command('list')
  .description('List your applications on subzero')
  .action(() => listApplications(readToken(), apps => {
    printApps(apps);
  }));

program.command('deploy')
  .option("-a, --dba <dba>", "Database administrator account(only needed for external db)")
  .option("-p, --password <password>", "Database administrator account password")
  .option("-t, --openresty-image-tag <tag>", "Tag for the new openresty image")
  .description('Deploy a subzero application, this will run the latest migrations and push the latest openresty image')
  .action(async options => {
    checkIsAppDir();
    deployApplication(options);
  });

program.command('create-config')
  .description('Create a subzero app config so that this project can be deployed to subzero.cloud')
  .option("-i, --id <id>", "application id")
  .action(async options => {
    checkIsAppDir()
    let token = readToken(),
        id =  options.id,
        as_json = options.json;
    if(! id){
      id = await getApplicationId();
    }
    getApplication(id, token, app => {
        saveSubzeroAppConfig(app);
    });
  });

program.command('describe')
  .description('Show status and properties of a subzero application')
  .option("-i, --id <id>", "application id")
  .action(async options => {
    let token = readToken(),
        id =  options.id
    if(! id){
      id = await getApplicationId();
    }
    getApplication(id, token, app => {
      printAppWithDescription(app);
    });
  });

program.command('reload-db-schema')
  .description('Reload database schema')
  .option("-i, --id <id>", "application id")
  .action(async options => {
    let token = readToken(),
        id =  options.id;
    if(! id){
      id = await getApplicationId();
    }
    reloadDatabaseSchema(id, token);
  });



program.parse(process.argv);
