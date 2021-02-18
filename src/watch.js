#!/usr/bin/env node
"use strict";


import readline from 'readline';

import colors from 'colors';


import {
  APP_DIR,
  WATCH_PATTERNS
} from './env.js';

import {checkIsAppDir, dockerContainers, runWatcher, resetDb} from './common.js';


const watcherReady = () => {
  console.log('Watching ' + WATCH_PATTERNS.map(p => p.replace(APP_DIR + '/','')).join(', ') + ` in ${APP_DIR} for changes.`);
}
const reloadStart = relPath => {
  console.log(`\n${relPath} changed`);
  console.log('Starting code reload..');
}
const reloadEnd = () => {
  console.log('Reload done');
}

const containers = dockerContainers();
if(Object.keys(containers).length == 0){
  console.log("No running containers. Exiting ...")
  process.exit();
} 
const watcher = runWatcher(containers, console, watcherReady, reloadStart, reloadEnd);

checkIsAppDir();

console.log("You can reset the db by pressing the 'r' button\n".white);

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if(key.name === "c" && key.ctrl)
    process.exit();

  if(key.name === "r") {
    resetDb(containers, console);
  }
});

process.on('exit', () => watcher.close());
