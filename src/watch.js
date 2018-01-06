#!/usr/bin/env node
"use strict";

import proc from 'child_process';
import fs from 'fs';
import os from 'os';
import colors from 'colors';
import chokidar from 'chokidar';
import {StringDecoder} from 'string_decoder';

import {
  COMPOSE_PROJECT_NAME,
  APP_DIR,
  PSQL_CMD,
  SUPER_USER,
  SUPER_USER_PASSWORD,
  DB_NAME,
  DB_DIR,
  WATCH_PATTERNS
} from './env.js';

import {runCmd} from './common.js';

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
  const containers = proc.execSync('docker ps -a -f name=${COMPOSE_PROJECT_NAME} --format "{{.Names}}"').toString('utf8').trim().split("\n");
  return containers.reduce( ( acc, containerName ) => {
    let key = containerName.replace(COMPOSE_PROJECT_NAME,'').replace('1','').replace(/_/g,'');
    acc[key] = {
      name: containerName,
      title: containerName.replace(COMPOSE_PROJECT_NAME+'_','').replace(/_1$/,'')
    };
    return acc;
  }, {});
}
