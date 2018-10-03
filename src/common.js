import proc from 'child_process';
import fs from 'fs';
import os from 'os';
import chokidar from 'chokidar';
import {StringDecoder} from 'string_decoder';
import {
  APP_DIR,
  PSQL_CMD,
  SQITCH_CMD,
  PG_DUMP_CMD,
  PG_DUMPALL_CMD,
  DOCKER_APP_DIR,
  DOCKER_IMAGE,
  USE_DOCKER_IMAGE,
  MIGRATIONS_DIR,
  OPENRESTY_DIR,
  JAVA_CMD,
  PLATFORM,
  DOCKER_HOST_OS,
  SUPER_USER,
  SUPER_USER_PASSWORD,
  DB_NAME,
  DB_DIR,
  COMPOSE_PROJECT_NAME,
  WATCH_PATTERNS
} from './env.js';

export const runCmd = (cmd, params, options = {}, silent = false, exit_on_error = false, use_async = false) => {
  if(USE_DOCKER_IMAGE && [PSQL_CMD, SQITCH_CMD, PG_DUMP_CMD, PG_DUMPALL_CMD, JAVA_CMD].indexOf(cmd) !== -1){
    //alter the command to run in docker
    let w = (options && options.cwd) ? options.cwd.replace(APP_DIR, DOCKER_APP_DIR) : DOCKER_APP_DIR;
    let e = (options && options.env) ? Object.keys(options.env).reduce(function(acc, key) {
      acc.push('-e')
      acc.push(key + '=' + options.env[key].replace(APP_DIR, DOCKER_APP_DIR)); 
      return acc;
    }, []):[];
    let u = [],
      hostAppDir = APP_DIR;

    if(PLATFORM == 'linux'){
      let {uid, gid} = os.userInfo();
      u = ['-u', `${uid}:${gid}`, '--env', "USERNAME=root"];
    }
    if(PLATFORM == 'win32'&& DOCKER_HOST_OS != "Docker for Windows"){
        // docker is running in virtualbox VM so we try to adjust the path to match the shared path
        hostAppDir = '/' + hostAppDir.replace(/([A-Z]):/,function(s){return s.toLocaleLowerCase().replace(':','')}).replace(/\\/g,'/')
    }
    let p = ['run', '--net', 'host', '--rm', '-w', w, '--env-file', `${APP_DIR}/.env`, '-v', `${hostAppDir}:${DOCKER_APP_DIR}`]
      .concat(e)
      .concat(u)
      .concat([DOCKER_IMAGE, cmd])
      .concat(params.map(v => v.replace(APP_DIR, DOCKER_APP_DIR)));
    cmd = 'docker';
    params = p;
  }

  if( !(silent || use_async) ){
    options.stdio = [ 'ignore', 1, 2 ];
  }
  let spawn = use_async ? proc.spawn : proc.spawnSync;
  let pr = spawn(cmd, params, options);
  if( !use_async && exit_on_error && pr.status != 0){
    process.exit(pr.status);
  }
  return pr;
}

export const checkPostgresConnection = (connection_string, pass, exit_on_error = true) => {
  console.log(`Checking PostgreSQL connection info (${connection_string})`);
  var env = Object.create( process.env );
  env.PGPASSWORD = pass;
  const random_number = Math.floor(Math.random() * 100).toString();
  const params = ['--quiet', '--tuples-only', '-c', `SELECT ${random_number}`, connection_string] 
  let result = runCmd(PSQL_CMD, params, { env: env }, true, false).stdout.toString().replace(/\s/g,'');
  if(random_number !== result){
    console.log(" ");
    console.log(`Could not verify the connection to PostgreSQL`);
    if(exit_on_error){
      process.exit(1);
    }
    else{
      return false;
    }
  }
  return true;
}
export const sqitchDeploy = url => runCmd(SQITCH_CMD, ["deploy", url], {cwd: MIGRATIONS_DIR}, false, true)

export const fileExists = path => fs.existsSync(path) && fs.statSync(path).isFile();

export const dirExists = path => fs.existsSync(path) && fs.statSync(path).isDirectory();

// options.key from commander returns bool if a value is not specified(e.g. subzero cloud login -u, options.username gives true), so make sure is a string
export const notEmptyString = s => (typeof s == 'string')&&s.trim().length;

export const checkIsAppDir = () => {
  if(!fileExists(`.env`)){
    console.log("Error: ".red + ".env file does not exist");
    console.log("Please run this command in a directory that contains a subzero project or you can create a base project with " +
                "`subzero base-project`".white);
    process.exit(0);
  }
}

export const checkMigrationsInitiated = () => {
  if( !(dirExists(MIGRATIONS_DIR) && fileExists(`${MIGRATIONS_DIR}/sqitch.plan`)) ){
    console.log("Error: ".red + "database migrations not initiated");
    console.log("Please run `subzero migrations init` before trying to deploy the code");
    process.exit(0);
  }
}

export const checkOpenrestyInitiated = () => {
  if( !(dirExists(OPENRESTY_DIR) && fileExists(`${OPENRESTY_DIR}/Dockerfile`)) ){
    console.log("Error: ".red + "Dockerfile for custom OpenResty image missing");
    console.log(`Please create ${OPENRESTY_DIR}/Dockerfile`);
    process.exit(0);
  }
}

const decoder = new StringDecoder('utf8');

export const resetDb = (containers, logger) => {
  const psql = runSql(['postgres',
    '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';`,
    '-c', `DROP DATABASE if exists ${DB_NAME};`,
    '-c', `CREATE DATABASE ${DB_NAME};`
  ], logger);
  psql.stderr.on('data', data => logger.log(decoder.write(data)));
  psql.on('close', code =>{
    const _psql = runSql( [DB_NAME, '-f', DB_DIR +'init.sql' ], logger)
    _psql.stderr.on('data', data => logger.log(decoder.write(data)));
    _psql.on('close', (code) => {
      if(code == 0){
        if(containers['postgrest']) {sendHUP(containers['postgrest'].name);}
        if(containers['openresty']) {sendHUP(containers['openresty'].name);}
      }
    })
  });
  return psql;
}

const sendHUP = containerName => proc.spawn('docker',['kill', '-s', 'HUP', containerName]);

const runSql = commands => {
  const connectParams = ['-U', SUPER_USER, '-h', 'localhost', '--set', 'DIR='+DB_DIR, '--set', 'ON_ERROR_STOP=1']
  var env = Object.create( process.env );
  env.PGPASSWORD = SUPER_USER_PASSWORD;
  env.DIR = DB_DIR;
  return runCmd(PSQL_CMD, connectParams.concat(commands), { env: env }, undefined, undefined, true);
}

export const runWatcher = (containers, logger, watcherReadyCb, reloadStartCb, reloadEndCb) => {
  return chokidar.watch(WATCH_PATTERNS, { ignored : APP_DIR+'/**/tests/**'})
  .on('change', path => {
    const relPath = path.replace(APP_DIR, '.');
    reloadStartCb(relPath);
    if(path.endsWith('.sql')){
      resetDb(containers, logger).on('close', reloadEndCb);
    }else{
      if(containers['openresty'])
        sendHUP(containers['openresty'].name).on('close', reloadEndCb);
      else
        reloadEndCb();
    }
  })
  .on('ready', watcherReadyCb);
}

export const dockerContainers = () => {
  const containers = proc.execSync(`docker ps -a -f name=${COMPOSE_PROJECT_NAME} --format "{{.Names}}"`).toString('utf8').trim().split("\n");
  return containers.reduce( ( acc, containerName ) => {
    let key = containerName.replace(COMPOSE_PROJECT_NAME,'').replace('1','').replace(/_/g,'');
    acc[key] = {
      name: containerName,
      title: containerName.replace(COMPOSE_PROJECT_NAME+'_','').replace(/_1$/,'')
    };
    return acc;
  }, {});
}

