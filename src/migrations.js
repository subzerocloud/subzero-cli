#!/usr/bin/env node
"use strict";

import program from 'commander';
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
    DB_USER,
    DB_PASS,
    APGDIFF_JAR_PATH,
    SQITCH_CMD,
    PG_DUMP_CMD,
    PG_DUMPALL_CMD,
    MIGRATIONS_DIR,
    DEV_DB_URI,
    PROD_DB_URI,
    IGNORE_ROLES
} from './env.js';

const TMP_DIR = `${MIGRATIONS_DIR}/tmp`;
const INITIAL_FILE_NAME = "initial";
const SQITCH_CONF = `${MIGRATIONS_DIR}/sqitch.conf`;
const MIGRATION_NUMBER_FILE = `${MIGRATIONS_DIR}/.migration_number`;

const initMigrations = () => {
  if (fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`Migrations directory already exists: ${MIGRATIONS_DIR}`);
    process.exit(0);
  }

  fs.mkdirSync(MIGRATIONS_DIR);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
  fs.writeFileSync(MIGRATION_NUMBER_FILE, '1');
  const migrationNumber = padNumber(getMigrationNumber(), 10);
  
  dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${INITIAL_FILE_NAME}.sql`);
  fs.closeSync(fs.openSync(`${TMP_DIR}/prod-${INITIAL_FILE_NAME}.sql`, 'w'));

  initSqitch();

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
const addMigration = (name, note, diff) => {

  if (!fs.existsSync(SQITCH_CONF) || !fs.statSync(SQITCH_CONF).isFile()){
    console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", CONF);
    process.exit(0);
  }
  const migrationNumber = padNumber(getMigrationNumber(), 10);
  if( diff ){
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

    dumpSchema(DEV_DB_URI, `${TMP_DIR}/dev-${name}.sql`);

    const containerName = getTempPostgres(`${MIGRATIONS_DIR}/deploy`);
    dumpSchema(PROD_DB_URI, `${TMP_DIR}/prod-${name}.sql`);
    stopContainer(containerName);
  }

  addSqitchMigration(`${migrationNumber}-${name}`, note);

  if( diff ){
    console.log('Diffing sql files')
    apgdiffToFile(`${TMP_DIR}/dev-${name}.sql`,
                  `${TMP_DIR}/prod-${name}.sql`,
                  `${MIGRATIONS_DIR}/revert/${migrationNumber}-${name}.sql`);
    apgdiffToFile(`${TMP_DIR}/prod-${name}.sql`,
                  `${TMP_DIR}/dev-${name}.sql`,
                  `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);

    rimraf.sync(TMP_DIR);
    console.log(`\x1b[31mATTENTION:\x1b[0m Make sure you check deploy/${migrationNumber}-${name}.sql for correctness, statement order is not handled!`);
  }
  else {
    console.log('Creating empty migration')
  }
  incrementMigrationNumber();
  
};

const runCmd = (cmd, params, options, silent) => {
  let p = proc.spawnSync(cmd, params, options);
  if(silent !== true){
    p.output.forEach(v => console.log(v ? v.toString() : ""));
  }
  if(p.status != 0){
    process.exit(p.status);
  }

}

const stopContainer = (name) => {
  runCmd("docker", [ "stop", name ], undefined, true);
  runCmd("docker", [ "rm", name ], undefined, true);
}
const writeInitSql = (file) => {
  fs.writeFileSync(file, [
    '-- custom setup sql',
    `create role "${DB_USER}" with login password '${DB_PASS}';`,
  ].join("\n"));
}
const getTempPostgres = (sqlDir) => {
  const name = 'temp_postgres_' + Math.random().toString(36).substr(2, 5);
  const initSqlFileName = padNumber(0, 10) + '-setup.sql';
  const initSqlFile = `${sqlDir}/${initSqlFileName}`;
  writeInitSql(initSqlFile);
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
      runCmd('docker', ['logs', '--tail', '30', name])
      console.log('Gave up on waiting for db. The last 30 lines of log are above.');
      stopContainer(name);
      fs.unlinkSync(initSqlFile);
      process.exit(-1);
    }
    let p = proc.spawnSync('docker', ['logs', '--since', timestamp, name ]);
    timestamp = Math.floor(new Date() / 1000);
    p.output.forEach(v => {
      if( v ){
        if( v.toString().indexOf('PostgreSQL init process complete; ready for start up.') !== -1 ){
          finishedLoading = true;
        }
      }
    });
    sleep.sleep(1);
  }
  sleep.sleep(1);
  fs.unlinkSync(initSqlFile);
  console.log('PostgreSQL init process complete; ready for start up.');
  return name;
}
const initSqitch = () => runCmd(SQITCH_CMD, ["init", DB_NAME, "--engine", "pg"], {cwd: MIGRATIONS_DIR})
const addSqitchMigration = (name, note) => runCmd(SQITCH_CMD, ["add", name, "-n", note || `Add ${name} migration`], {cwd: MIGRATIONS_DIR})
const dumpSchema = (DB_URI, file) => {
  const replace_superuser = new RegExp(`GRANT ([a-z0-9_-]+) TO ${SUPER_USER}`, "gi");
  runCmd(PG_DUMPALL_CMD, ['-f', `${file}.roles`, '--roles-only', '-d', DB_URI]);
  runCmd(PG_DUMP_CMD, [DB_URI, '-f', `${file}.schema`, '--schema-only']);
  let data = [
		fs.readFileSync(`${file}.roles`, 'utf-8')
      .split("\n")
      .filter(ln => IGNORE_ROLES.map(r => ln.indexOf('ROLE '+r)).every(p => p == -1) ) //filter out line referring to ignored roles
      .map(ln => ln.replace(` GRANTED BY ${SUPER_USER}`, '')) //remove unwanted string
      .filter(ln => ln.indexOf('ALTER ROLE') == -1) //RDS does not allow this
      .map(ln => ln.replace(replace_superuser, 'GRANT $1 TO current_user'))
      .join("\n"),
    fs.readFileSync(`${file}.schema`, 'utf-8')
      .split("\n")
      .filter(ln => ln.indexOf('COMMENT ON EXTENSION') == -1) //RDS doew not allow this
      .filter(ln => ln.indexOf(`OWNER TO ${SUPER_USER};`) == -1) //don't keep owner info when the owner is privileges
      .join("\n")

  ];
  fs.writeFileSync(file, data.join("\n"), 'utf-8');
  fs.unlinkSync(`${file}.roles`);
  fs.unlinkSync(`${file}.schema`);
}
const apgdiffToFile = (file1, file2, destFile) => {
  let p = proc.spawnSync('java', ['-jar', APGDIFF_JAR_PATH, '--add-transaction', file1, file2]);
  if(p.stdout.toString())
    fs.writeFileSync(destFile, p.stdout.toString());
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

program
  .command('init')
  .description('Setup sqitch config and create the first migration')
  .action(() => initMigrations());

program
  .command('add <name>')
  .option("-n, --note [note]", "Add sqitch migration note")
  .option("-d, --no-diff", "Add empty sqitch migration (no diff)")
  .description('Adds a new sqitch migration')
  .action((name, options) => {
      addMigration(name, options.note, options.diff);
  });

program.parse(process.argv);
