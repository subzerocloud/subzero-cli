import proc from 'child_process';
import fs from 'fs';
import os from 'os';
import colors from 'colors';

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
  JAVA_CMD
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
    let u = []
    if(os.platform() == 'linux'){
      let {uid, gid} = os.userInfo();
      u = ['-u', `${uid}:${gid}`, '--env', "USERNAME=root"];
    }
    let p = ['run', '--net', 'host', '--rm', '-w', w, '--env-file', `${APP_DIR}/.env`, '-v', `${APP_DIR}:${DOCKER_APP_DIR}`]
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

export const sqitchDeploy = url => runCmd(SQITCH_CMD, ["deploy", url], {cwd: MIGRATIONS_DIR})

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
