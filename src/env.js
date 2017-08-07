import {dirname,resolve} from 'path';
import {config} from 'dotenv';
import {program} from './program.js';
import fs from 'fs';


let cfg = {
  path: typeof(program.env) == 'string' ? program.env : '.env'
};

if (!fs.existsSync(cfg.path) || !fs.statSync(cfg.path).isFile()) {
  console.log("\x1b[31mError:\x1b[0m .env file '%s' does not exist", cfg.path);
  process.exit(0);
}

config(cfg);//.env file vars added to process.env
process.env.ENV_FILE = resolve(cfg.path)
process.env.APP_DIR = dirname(process.env.ENV_FILE);

export const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;
export const APP_DIR = process.env.APP_DIR;
export const ENV_FILE = process.env.ENV_FILE;
export const SUPER_USER = process.env.SUPER_USER;
export const SUPER_USER_PASSWORD = process.env.SUPER_USER_PASSWORD;
export const DB_USER = process.env.DB_USER;
export const DB_PASS = process.env.DB_PASS;
export const DB_HOST = process.env.DB_HOST;
export const DB_NAME = process.env.DB_NAME;
export const LOG_LENGTH = process.env.LOG_LENGTH || 1000;
export const PROD_PG_URI = process.env.PROD_PG_URI || 1000;
/**
 * apgdiff with patches
 * curl -L https://patch-diff.githubusercontent.com/raw/fordfrog/apgdiff/pull/210.patch > 210.patch
 * git apply --check 210.patch
 */
export const APGDIFF_JAR_PATH = process.env.APGDIFF_JAR_PATH || 'apgdiff-2.4.jar'; 
export const SQITCH_CMD = process.env.SQITCH_CMD || 'sqitch'; 
export const PSQL_CMD = process.env.PSQL_CMD || 'psql';
export const PG_DUMP_CMD = process.env.PG_DUMP_CMD || 'pg_dump';
export const PG_DUMPALL_CMD = process.env.PG_DUMP_CMD || 'pg_dumpall';
export const MIGRATIONS_DIR = `${APP_DIR}/db/migrations`;
export const DEV_DB_URI = process.env.DEV_DB_URI || `postgres://${SUPER_USER}:${SUPER_USER_PASSWORD}@localhost:5432/${DB_NAME}`
export const PROD_DB_URI = process.env.PROD_DB_URI || `postgres://${SUPER_USER}:${SUPER_USER_PASSWORD}@localhost:5433/${DB_NAME}`
const _IGNORE_ROLES = process.env.IGNORE_ROLES || `${SUPER_USER}, ${DB_USER}, postgres`
export const IGNORE_ROLES = _IGNORE_ROLES.split(',').map(s => s.trim());


