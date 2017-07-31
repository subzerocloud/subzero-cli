"use strict";
import proc from 'child_process';
import fs from 'fs';
import rimraf from 'rimraf';

import {
    COMPOSE_PROJECT_NAME,
    APP_DIR,
    SUPER_USER,
    SUPER_USER_PASSWORD,
    DB_HOST,
    DB_NAME,
    PROD_PG_URI,
    APGDIFF_JAR_PATH,
    SQITCH_CMD,
    PG_DUMP_CMD,
    MIGRATIONS_DIR,
    DEV_DB_URI,
    PROD_DB_URI

} from './env.js';

const TMP_DIR = `${MIGRATIONS_DIR}/tmp`;
const INITIAL_FILE_NAME = "initial";
const SQITCH_CONF = `${MIGRATIONS_DIR}/sqitch.conf`;

const initMigrations = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) fs.mkdirSync(MIGRATIONS_DIR);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
  initSqitch();

  dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`);
  fs.closeSync(fs.openSync(`${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`, 'w'));
  
  addSqitchMigration(INITIAL_FILE_NAME);

  apgdiffToFile(`${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`,
                `${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`,
                `${MIGRATIONS_DIR}/revert/${INITIAL_FILE_NAME}.sql`);
  apgdiffToFile(`${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`,
                `${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`,
                `${MIGRATIONS_DIR}/deploy/${INITIAL_FILE_NAME}.sql`);

  rimraf.sync(TMP_DIR);
};

const addMigration = (name, note) => {

  if (!fs.existsSync(SQITCH_CONF) || !fs.statSync(SQITCH_CONF).isFile()){
    console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", CONF);
    process.exit(0);
  }

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

  dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${name}.sql`);
  dumpSchema(PROD_DB_URI, `${TMP_DIR}/prod-${name}.sql`);

  addSqitchMigration(name, note);

  apgdiffToFile(`${TMP_DIR}/dev-${name}.sql`,
                `${TMP_DIR}/prod-${name}.sql`,
                `${MIGRATIONS_DIR}/revert/${name}.sql`);
  apgdiffToFile(`${TMP_DIR}/prod-${name}.sql`,
                `${TMP_DIR}/dev-${name}.sql`,
                `${MIGRATIONS_DIR}/deploy/${name}.sql`);

  rimraf.sync(TMP_DIR);
};

const runCmd = (cmd, params, options) => {
  let p = proc.spawnSync(cmd, params, options);
  p.output.forEach(v => console.log(v ? v.toString() : ""));
  if(p.status != 0){
    process.exit(p.status);
  }
}

const initSqitch = () => runCmd(SQITCH_CMD, ["init", DB_NAME, "--engine", "pg"], {cwd: MIGRATIONS_DIR})
const addSqitchMigration = (name, note) => runCmd(SQITCH_CMD, ["add", name, "-n", note || `Add ${name} migration`], {cwd: MIGRATIONS_DIR})
const dumpSchema = (DB_URI, file) => runCmd(PG_DUMP_CMD, [DB_URI, '-f', file, '--schema-only', '--no-owner', '--no-privileges'])
const apgdiffToFile = (file1, file2, destFile) => {
  let p = proc.spawnSync('java', ['-jar', APGDIFF_JAR_PATH, '--add-transaction', file1, file2]);
  if(p.stdout.toString())
    fs.writeFileSync(destFile, p.stdout.toString());
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

//const surroundWithBeginCommit = str => "BEGIN;\n" + str + "\nCOMMIT;"

export { initMigrations, addMigration };
