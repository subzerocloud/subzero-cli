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
  WATCH_PATTERNS,
  MIGRA_CMD
} from './env.js';

export const runCmd = (cmd, params, options = {}, silent = false, exit_on_error = false, use_async = false, stdio) => {
  if(USE_DOCKER_IMAGE && [PSQL_CMD, SQITCH_CMD, PG_DUMP_CMD, PG_DUMPALL_CMD, JAVA_CMD, MIGRA_CMD].indexOf(cmd) !== -1){
    //alter the command to run in docker
    let app_dir_regexp = new RegExp(APP_DIR, 'g');
    let w = (options && options.cwd) ? options.cwd.replace(APP_DIR, DOCKER_APP_DIR) : DOCKER_APP_DIR;
    let e = (options && options.env) ? Object.keys(options.env).reduce(function(acc, key) {
      acc.push('-e')
      acc.push(key + '=' + options.env[key].replace(app_dir_regexp, DOCKER_APP_DIR)); 
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
    let ef = fileExists(`.env`) ? ['--env-file', `${APP_DIR}/.env`]:[]
    let p = ['run', '--net', 'host', '--rm', '-w', w, '-v', `${hostAppDir}:${DOCKER_APP_DIR}`]
      .concat(e)
      .concat(u)
      .concat(ef)
      .concat([DOCKER_IMAGE, cmd])
      .concat(params.map(v => v.replace(app_dir_regexp, DOCKER_APP_DIR)));
    cmd = 'docker';
    params = p;
  }

  if( !(silent || use_async) ){
    options.stdio = stdio || [ 'ignore', 1, 2 ];
  }
  let spawn = use_async ? proc.spawn : proc.spawnSync;
  //console.log(cmd, params, options);
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
    console.log("Please run this command in a directory that contains a subzero/postgrest project.\nYou can create a poject with " +
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
  logger.log('starting db reset');
  const recreatedb = runSql(['postgres',
    '--quiet',
    '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';`,
    '-c', `DROP DATABASE if exists ${DB_NAME};`,
    '-c', `CREATE DATABASE ${DB_NAME};`
  ], false);
  let err = decoder.write(recreatedb.stderr).trim();
  if(err.length>0) logger.log(err);
  const psql = runSql( [DB_NAME, '-f', DB_DIR +'/init.sql' ], false)
  err = decoder.write(psql.stderr).trim();
  if(err.length>0) logger.log(err);
  if(psql.status == 0){
    //support old style starter kit
    if(containers['postgrest']) {sendHUP(containers['postgrest'].name, 'SIGUSR1');}
    if(containers['openresty']) {sendHUP(containers['openresty'].name);}

    logger.log('db reset done');
  }
  else{
    logger.log('db reset failed');
  }
  
  return psql;
}

const sendHUP = (containerName, signal = 'HUP') => proc.spawn('docker',['kill', '-s', signal, containerName]);

const runSql = (commands, use_async = true) => {
  const connectParams = ['-U', SUPER_USER, '-h', 'localhost', '--set', 'DIR='+DB_DIR+'/', '--set', 'ON_ERROR_STOP=1']
  var env = Object.create( process.env );
  env.PGPASSWORD = SUPER_USER_PASSWORD;
  env.DIR = DB_DIR;
  const stdio = use_async ? undefined : [ 'ignore', 'pipe', 'pipe' ]
  return runCmd(PSQL_CMD, connectParams.concat(commands), { env: env }, undefined, undefined, use_async, stdio);
}

export const runWatcher = (containers, logger, watcherReadyCb, reloadStartCb, reloadEndCb) => {
  return chokidar.watch(WATCH_PATTERNS, { ignored : APP_DIR+'/**/tests/**'})
  .on('change', path => {
    const relPath = path.replace(APP_DIR, '.');
    reloadStartCb(relPath);
    if(path.endsWith('.sql')){
      const result = resetDb(containers, logger);
      reloadEndCb(result.status);
    }else{
      if(containers['openresty']){
        sendHUP(containers['openresty'].name).on('close', function(){ reloadEndCb(0) });
      }
      else{
        reloadEndCb(0);
      }
    }
  })
  .on('ready', watcherReadyCb);
}

export const dockerContainers = () => {
  const filters_params = proc.execSync(`docker-compose ps -q | cut -c 1-12`).toString('utf8').trim().split("\n").map(id => '--filter id='+id);
  const containers = proc.execSync(`docker ps -a --format "{{.Names}}" ` + filters_params.join(' ')).toString('utf8').trim().split("\n");
  const result = containers.reduce( ( acc, containerName ) => {
    let key = containerName.replace(COMPOSE_PROJECT_NAME,'').replace('1','').replace(/_/g,'');
    if(key == "") return acc;
    acc[key] = {
      name: containerName,
      title: containerName.replace(COMPOSE_PROJECT_NAME+'_','').replace(/_1$/,'')
    };
    return acc;
  }, {});
  return result;
}

