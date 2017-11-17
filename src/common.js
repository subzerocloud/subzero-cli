import proc from 'child_process';
import fs from 'fs';
import colors from 'colors';

import {
  APP_DIR,
  SQITCH_CMD,
  PG_DUMP_CMD,
  PG_DUMPALL_CMD,
  DOCKER_APP_DIR,
  DOCKER_IMAGE,
  USE_DOCKER_IMAGE,
  MIGRATIONS_DIR,
  JAVA_CMD
} from './env.js';

export const runCmd = (cmd, params, options, silent) => {
  if(USE_DOCKER_IMAGE && [SQITCH_CMD, PG_DUMP_CMD, PG_DUMPALL_CMD, JAVA_CMD].indexOf(cmd) !== -1){
    //alter the command to run in docker
    let w = (options && options.cwd) ? options.cwd.replace(APP_DIR, DOCKER_APP_DIR) : DOCKER_APP_DIR;
    params = ['run', '--rm', '-w', w, '-v', `${APP_DIR}:${DOCKER_APP_DIR}`, DOCKER_IMAGE, cmd]
      .concat(params.map(p => p.replace(APP_DIR, DOCKER_APP_DIR)));
    cmd = 'docker';
  }
  let p = proc.spawnSync(cmd, params, options);
  if(silent !== true){
    p.output.forEach(v => console.log(v ? v.toString() : ""));
  }
  if(p.status != 0){
    process.exit(p.status);
  }
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
