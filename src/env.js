import {dirname,resolve} from 'path';
import {config} from 'dotenv';
import fs from 'fs';
import os from 'os';
import proc from 'child_process';
import {version} from '../package.json';

let cfg = {
  //path: typeof(program.env) == 'string' ? program.env : '.env'
  path: '.env'
};

if (fs.existsSync(cfg.path) && fs.statSync(cfg.path).isFile()) {
  config(cfg);//.env file vars added to process.env
  process.env.ENV_FILE = resolve(cfg.path).replace(/\\/g, '/');
  process.env.APP_DIR = dirname(process.env.ENV_FILE);
}

export const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;
export const FILTER_DB_APP_NAME = process.env.FILTER_DB_APP_NAME?new RegExp(process.env.FILTER_DB_APP_NAME):null;
export const HIDE_DB_LOG_LINE = process.env.HIDE_DB_LOG_LINE?new RegExp(process.env.HIDE_DB_LOG_LINE):null
export const DB_CONTAIENR_NAME = process.env.DB_CONTAIENR_NAME || 'db';
export const MIGRATION_INCLUDE_BEGINNING = process.env.MIGRATION_INCLUDE_BEGINNING || null;
export const MIGRATION_INCLUDE_END = process.env.MIGRATION_INCLUDE_END || null;
export const DB_LOG_LINE_MARKER = process.env.DB_LOG_LINE_MARKER;
export const SQL_DIFF_TOOL = process.env.SQL_DIFF_TOOL || 'apgdiff';
export const APP_DIR = process.env.APP_DIR || process.cwd();
export const ENV_FILE = process.env.ENV_FILE;
export const SUPER_USER = process.env.SUPER_USER;
export const SUPER_USER_PASSWORD = process.env.SUPER_USER_PASSWORD;
export const DB_USER = process.env.DB_USER;
export const DB_PASS = process.env.DB_PASS;
export const DB_HOST = process.env.DB_HOST;
export const DB_NAME = process.env.DB_NAME;
export const DB_ANON_ROLE = process.env.DB_ANON_ROLE;
export const DB_PORT = process.env.DB_PORT;
export const LOG_LENGTH = process.env.LOG_LENGTH || 5000;
export const JAVA_CMD = process.env.JAVA_CMD || 'java'; 
export const APGDIFF_JAR_PATH = process.env.APGDIFF_JAR_PATH || '/usr/local/bin/apgdiff.jar'; 
// export const SQLWORKBENCH_JAR_PATH = process.env.SQLWORKBENCH_JAR_PATH || '/workbench/sqlworkbench.jar';
// export const SQLWORKBENCH_CMD = process.env.SQLWORKBENCH_CMD || 'WbDataDiff -referenceConnection=$DBURL_FROM -targetConnection=$DBURL_TARGET -file=$DEST_FILE -singleFile=true -includeDelete=true -ignoreMissingTarget=true;';
export const SQITCH_CMD = process.env.SQITCH_CMD || 'sqitch';
export const MIGRA_CMD = process.env.SQITCH_CMD || 'migra';
export const PSQL_CMD = process.env.PSQL_CMD || 'psql';
export const PG_DUMP_CMD = process.env.PG_DUMP_CMD || 'pg_dump';
export const PG_DUMPALL_CMD = process.env.PG_DUMP_CMD || 'pg_dumpall';
export const MIGRATIONS_DIR = `${APP_DIR}/db/migrations`;
export const OPENRESTY_DIR = `${APP_DIR}/openresty`;
export const USE_DOCKER_IMAGE = process.env.USE_DOCKER_IMAGE || true;
export const LOCALHOST = 'localhost';
export const DEV_DB_URI = process.env.DEV_DB_URI || `postgres://${SUPER_USER}:${SUPER_USER_PASSWORD}@${LOCALHOST}:${DB_PORT}/${DB_NAME}`
const _IGNORE_ROLES = process.env.IGNORE_ROLES || `${SUPER_USER}, ${DB_USER}, postgres`
export const IGNORE_ROLES = _IGNORE_ROLES.split(',').map(s => s.trim());
export const DOCKER_APP_DIR = '/src';
export const DOCKER_IMAGE = process.env.DOCKER_IMAGE || ('subzerocloud/subzero-cli-tools:v'+version)
export const DOCKER_MIGRATIONS_DIR = `${DOCKER_APP_DIR}/db/migrations`;
export const DB_DIR = process.env.DB_DIR || `${APP_DIR}/db/src`;
export const WATCH_PATTERNS = process.env.WATCH_PATTERNS
               ? process.env.WATCH_PATTERNS.split(',').map(p => APP_DIR + '/' + p)
               : [APP_DIR +'/db/src/**/*.sql', APP_DIR + '/openresty/**/*.lua', APP_DIR +'/openresty/**/*.conf'];
export const PLATFORM = os.platform();
export const DOCKER_HOST_OS = USE_DOCKER_IMAGE ? proc.execSync('docker info -f "{{ .OSType}}"').toString('utf8').trim() : null;
export const PG_VERSION = process.env.PG_VERSION ? process.env.PG_VERSION : null;
