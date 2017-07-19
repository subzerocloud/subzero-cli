"use strict";
import proc from 'child_process';
import {config} from 'dotenv';
import fs from 'fs';
import rimraf from 'rimraf';

config();

const DEV_DB_NAME = process.env.DB_NAME;
const DEV_SUPER_USER = process.env.SUPER_USER;

const PROD_PG_URI = process.env.PROD_PG_URI;

const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;

const APGDIFF_PATH = process.env.APGDIFF_PATH || './apgdiff.jar'; 
const SQITCH_PATH = process.env.SQITCH_PATH || 'sqitch'; 

const MIGRATIONS_DIR = "./db/migrations";

const initMigrations = () => {
  const INITIAL_FILE_NAME = "initial";
  initSqitch();
  addSqitchMigration(INITIAL_FILE_NAME);
  devPgDumpToFile(`${MIGRATIONS_DIR}/deploy/${INITIAL_FILE_NAME}.sql`);
  apgdiffToFile(`${MIGRATIONS_DIR}/deploy/${INITIAL_FILE_NAME}.sql`,
                `${MIGRATIONS_DIR}/revert/${INITIAL_FILE_NAME}.sql`,
                `${MIGRATIONS_DIR}/revert/${INITIAL_FILE_NAME}.sql`);
};

const addMigration = (name, note) => {

  const TMP_DIR = `${MIGRATIONS_DIR}/tmp`;

  const createTmpDir = () => {
    if (!fs.existsSync(TMP_DIR))
      fs.mkdirSync(TMP_DIR);
  };

  const removeTmpDir = () => {
    rimraf.sync(TMP_DIR);
  };

  const sqitchConfMustExist = () => {
    const CONF = "sqitch.conf";
    if (!fs.existsSync(CONF) || !fs.statSync(CONF).isFile()){
      console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", CONF);
      process.exit(0);
    }
  }

  sqitchConfMustExist();

  createTmpDir();

  devPgDumpToFile(`${TMP_DIR}/dev-${name}.sql`);
  prodPgDumpToFile(`${TMP_DIR}/prod-${name}.sql`);

  addSqitchMigration(name, note);

  apgdiffToFile(`${TMP_DIR}/dev-${name}.sql`,
                `${TMP_DIR}/prod-${name}.sql`,
                `${MIGRATIONS_DIR}/deploy/${name}.sql`);
  apgdiffToFile(`${TMP_DIR}/prod-${name}.sql`,
                `${TMP_DIR}/dev-${name}.sql`,
                `${MIGRATIONS_DIR}/revert/${name}.sql`);

  removeTmpDir();
};

const initSqitch = () => {
  let p = proc.spawnSync(SQITCH_PATH, ["init", DEV_DB_NAME, "--engine", "pg", "--top-dir", MIGRATIONS_DIR]);
  if(p.stdout.toString())
    console.log(p.stdout.toString());
  if(p.stderr.toString()){
    console.log(p.stderr.toString());
    process.exit(0);
  }
};

const addSqitchMigration = (name, note) => {
  let p = proc.spawnSync(SQITCH_PATH, ["add", name, "-n", note || `Add ${name} migration`]);
  if(p.stdout.toString())
    console.log(p.stdout.toString());
  if(p.stderr.toString()){
    console.log(p.stderr.toString());
    process.exit(0);
  }
};

const devPgDumpToFile = file => {
  let p = proc.spawnSync('docker', ['exec', `${COMPOSE_PROJECT_NAME}_db_1`, 'pg_dump', DEV_DB_NAME, '-U', DEV_SUPER_USER]);
  if(p.stdout.toString())
    fs.writeFileSync(file, surroundWithBeginCommit(p.stdout.toString()));
  if(p.stderr.toString()){
    console.log(p.stderr.toString());
    process.exit(0);
  }
};

const prodPgDumpToFile = file => {
  console.log("Getting dump from production database...");
  let p = proc.spawnSync('docker', ['exec', `${COMPOSE_PROJECT_NAME}_db_1`, 'pg_dump', PROD_PG_URI]);
  if(p.stdout.toString()){
    fs.writeFileSync(file, surroundWithBeginCommit(p.stdout.toString()));
    console.log("Done.");
  }
  if(p.stderr.toString()){
    console.log(p.stderr.toString());
    process.exit(0);
  }
};

const apgdiffToFile = (file1, file2, destFile) => {
  let p = proc.spawnSync('java', ['-jar', APGDIFF_PATH, file1, file2]);
  if(p.stdout.toString())
    fs.writeFileSync(destFile, surroundWithBeginCommit(p.stdout.toString()));
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

const surroundWithBeginCommit = str => "BEGIN;\n" + str + "\nCOMMIT;"

const deployMigrations = () => {
  let p = proc.spawnSync(SQITCH_PATH, ["deploy", `db:${PROD_PG_URI}`]);
  if(p.stdout.toString())
    console.log(p.stdout.toString());
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

export { initMigrations, addMigration, deployMigrations };
