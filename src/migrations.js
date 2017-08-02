"use strict";
import proc from 'child_process';
import fs from 'fs';
import rimraf from 'rimraf';
import sleep from 'sleep';

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
const MIGRATION_NUMBER_FILE = `${MIGRATIONS_DIR}/.migration_number`;

const initMigrations = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) fs.mkdirSync(MIGRATIONS_DIR);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
  fs.writeFileSync(MIGRATION_NUMBER_FILE, '0');
  const migrationNumber = padNumber(getMigrationNumber(), 10);
  initSqitch();

  dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`);
  fs.closeSync(fs.openSync(`${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`, 'w'));
  
  addSqitchMigration(`${migrationNumber}-${INITIAL_FILE_NAME}`);

  apgdiffToFile(`${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`,
                `${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`,
                `${MIGRATIONS_DIR}/revert/${migrationNumber}-${INITIAL_FILE_NAME}.sql`);
  runCmd('cp', [`${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`, `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${INITIAL_FILE_NAME}.sql`]);
  // apgdiffToFile(`${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`,
  //               `${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`,
  //               `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${INITIAL_FILE_NAME}.sql`);

  incrementMigrationNumber();
  rimraf.sync(TMP_DIR);
};

const padNumber = (n, len) => {
    const s = n.toString();
    return (s.length < len) ? ('0000000000' + s).slice(-len) : s;    
}
const getMigrationNumber = () => parseInt(fs.readFileSync(MIGRATION_NUMBER_FILE))
const incrementMigrationNumber = () => fs.writeFileSync(MIGRATION_NUMBER_FILE, (getMigrationNumber() + 1).toString());
const addMigration = (name, note) => {

  if (!fs.existsSync(SQITCH_CONF) || !fs.statSync(SQITCH_CONF).isFile()){
    console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", CONF);
    process.exit(0);
  }
  const migrationNumber = padNumber(getMigrationNumber(), 10);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

  dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${name}.sql`);

  const containerName = getTempPostgres(`${MIGRATIONS_DIR}/deploy`);
  dumpSchema(PROD_DB_URI, `${TMP_DIR}/prod-${name}.sql`);
  stopContainer(containerName);

  addSqitchMigration(`${migrationNumber}-${name}`, note);

  apgdiffToFile(`${TMP_DIR}/dev-${name}.sql`,
                `${TMP_DIR}/prod-${name}.sql`,
                `${MIGRATIONS_DIR}/revert/${migrationNumber}-${name}.sql`);
  apgdiffToFile(`${TMP_DIR}/prod-${name}.sql`,
                `${TMP_DIR}/dev-${name}.sql`,
                `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);

  incrementMigrationNumber();
  rimraf.sync(TMP_DIR);
};

const runCmd = (cmd, params, options) => {
  let p = proc.spawnSync(cmd, params, options);
  p.output.forEach(v => console.log(v ? v.toString() : ""));
  if(p.status != 0){
    process.exit(p.status);
  }

}

const stopContainer = (name) => {
  runCmd("docker", [ "stop", name ]);
  runCmd("docker", [ "rm", name ]);
}
const getTempPostgres = (sqlDir) => {
  const name = 'temp_postgres_' + Math.random().toString(36).substr(2, 5);
  console.log('Starting temporary Postgre database')
  runCmd("docker", [ 
    "run", "-d", 
    "--name", name,
    "-p", "5433:5432", 
    "-e", `POSTGRES_DB=${DB_NAME}`, 
    "-e", `POSTGRES_USER=${SUPER_USER}`, 
    "-e", `POSTGRES_PASSWORD=${SUPER_USER_PASSWORD}`,
    "-v", `${sqlDir}:/docker-entrypoint-initdb.d`,
    "postgres"
  ]);

  console.log('Waiting for it to load')
  let finishedLoading = false;
  let timestamp = 0;
  let iterations = 0;
  const maxIterations = 60;
  while( !finishedLoading ){
    iterations = iterations + 1;
    if( iterations > maxIterations ){
      console.log('Giving up on waiting for db');
      process.exit(-1);
    }
    let p = proc.spawnSync('docker', ['logs', '--since', timestamp, name ]);
    timestamp = Math.floor(new Date() / 1000);
    p.output.forEach(v => {
      if( v ){
        console.log(v.toString())
        if( v.toString().indexOf('PostgreSQL init process complete; ready for start up.') !== -1 ){
          finishedLoading = true;
        }
      }
    });
    sleep.sleep(1);
  }
  sleep.sleep(1);
  console.log('PostgreSQL init process complete; ready for start up.');
  return name;
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
