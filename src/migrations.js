#!/usr/bin/env node
"use strict";

import program from 'commander';
import proc from 'child_process';
import fs from 'fs';
import sleep from 'sleep';
import {runCmd, checkIsAppDir, sqitchDeploy, checkMigrationsInitiated, checkPostgresConnection} from './common.js';
import { createServer } from 'net'

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
    JAVA_CMD,
    MIGRATIONS_DIR,
    DEV_DB_URI,
    IGNORE_ROLES,
    DOCKER_APP_DIR,
    DOCKER_IMAGE,
    USE_DOCKER_IMAGE,
    PSQL_CMD,
    DB_DIR,
    LOCALHOST
} from './env.js';

const TMP_DIR = `${MIGRATIONS_DIR}/tmp`;
const INITIAL_FILE_NAME = "initial";
const SQITCH_CONF = `${MIGRATIONS_DIR}/sqitch.conf`;
const INIT_SQL_FILENAME = '0000000000-setup.sql';
  

const getFreePort = async () => {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.on('listening', () => (port => server.close(() => resolve(port)))(server.address().port))
    server.listen(0)
  })
}

const initMigrations = async (debug, dbDockerImage) => {

  if (fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`Migrations directory already exists: ${MIGRATIONS_DIR}`);
    process.exit(-1);
  }

  const name = INITIAL_FILE_NAME;
  const migrationNumber = getMigrationNumber();

  fs.mkdirSync(MIGRATIONS_DIR);
  fs.mkdirSync(TMP_DIR);

  const {containerName: devDbcontainerName, dbUri: devDbUri, initSqlFile: devInitSqlFile} = await getTempPostgres(DB_DIR, debug, dbDockerImage);
  const devDbContianerReady = waitForDbContainer(devDbcontainerName, devInitSqlFile, debug);
  if(!devDbContianerReady){
    stopContainer(devDbcontainerName);
    process.exit(-1); 
  }
  dumpSchema(devDbUri, `${TMP_DIR}/${migrationNumber}-dev-${name}.sql`);
  stopContainer(devDbcontainerName);
  fs.closeSync(fs.openSync(`${TMP_DIR}/${migrationNumber}-prod-${name}.sql`, 'w'));

  
  initSqitch();

  addSqitchMigration(`${migrationNumber}-${name}`);

  apgdiffToFile(`${TMP_DIR}/${migrationNumber}-dev-${name}.sql`,
                `${TMP_DIR}/${migrationNumber}-prod-${name}.sql`,
                `${TMP_DIR}/${migrationNumber}-revert-${name}.sql`);

  console.log(`Copying ${TMP_DIR}/${migrationNumber}-dev-${name}.sql to ${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);
  fs.copyFileSync(`${TMP_DIR}/${migrationNumber}-dev-${name}.sql`, `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);

  fs.unlinkSync(`${TMP_DIR}/${migrationNumber}-dev-${name}.sql`);
  fs.unlinkSync(`${TMP_DIR}/${migrationNumber}-prod-${name}.sql`);
  fs.unlinkSync(`${TMP_DIR}/${migrationNumber}-revert-${name}.sql`)
};

const addMigration = async (name, note, diff, dryRun, debug, dbUri, dbDockerImage, diffRoles) => {

  if (!fs.existsSync(SQITCH_CONF) || !fs.statSync(SQITCH_CONF).isFile()){
    console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", SQITCH_CONF);
    process.exit(-1);
  }
  if(dbUri){
    checkPostgresConnection(dbUri, '');
  }
  const migrationNumber = getMigrationNumber(),
        tmpDevSql = `${TMP_DIR}/${migrationNumber}-dev-${name}.sql`,
        tmpProdSql = `${TMP_DIR}/${migrationNumber}-prod-${name}.sql`,
        tmpDeploySql = `${TMP_DIR}/${migrationNumber}-deploy-${name}.sql`,
        tmpRevertSql = `${TMP_DIR}/${migrationNumber}-revert-${name}.sql`;
  if( diff ){
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
    
    const {containerName: devDbcontainerName, dbUri: devDbUri, initSqlFile: devInitSqlFile} = await getTempPostgres(DB_DIR, debug, dbDockerImage);
    const devDbContianerReady = waitForDbContainer(devDbcontainerName, devInitSqlFile, debug);
    if(!devDbContianerReady){
      stopContainer(devDbcontainerName);
      process.exit(-1); 
    }
    dumpSchema(devDbUri, tmpDevSql, diffRoles);
    stopContainer(devDbcontainerName);

    if(dbUri){
      dumpSchema(dbUri, tmpProdSql, diffRoles);
    }
    else{
      const {containerName: prodDbcontainerName, dbUri: prodDbUri, initSqlFile: prodInitSqlFile} = await getTempPostgres(`${MIGRATIONS_DIR}/deploy`, debug, dbDockerImage);
      const prodDbContianerReady = waitForDbContainer(prodDbcontainerName, prodInitSqlFile, debug);
      if(!prodDbContianerReady){
        stopContainer(prodDbcontainerName);
        process.exit(-1); 
      }
      dumpSchema(prodDbUri, tmpProdSql, diffRoles);
      stopContainer(prodDbcontainerName);
    }
   
    apgdiffToFile(tmpDevSql,
                  tmpProdSql,
                  tmpRevertSql);
    apgdiffToFile(tmpProdSql,
                  tmpDevSql,
                  tmpDeploySql);
  }
  

  if(!dryRun){
    addSqitchMigration(`${migrationNumber}-${name}`, note);
    if(diff){
      if(fs.existsSync(tmpDeploySql)){
        fs.copyFileSync(tmpDeploySql, `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);
      }
      else{console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", `${migrationNumber}-deploy-${name}.sql`);}

      if(fs.existsSync(tmpRevertSql)){
        fs.copyFileSync(tmpRevertSql, `${MIGRATIONS_DIR}/revert/${migrationNumber}-${name}.sql`);
      }
      else{console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", `${migrationNumber}-revert-${name}.sql`);}
      console.log(`\x1b[31mATTENTION:\x1b[0m Make sure you check deploy/${migrationNumber}-${name}.sql for correctness, statement order is not handled!`);
    }
    else {
      console.log('Creating empty migration')
    }
    
  }
  else{
    console.log("\nCurrent migration DDL");
    console.log("=====================================================")
    if(fs.existsSync(tmpDeploySql)){console.log(fs.readFileSync(tmpDeploySql, 'utf-8'))}
  }
  
  if(!debug){
    if(fs.existsSync(tmpDevSql)){fs.unlinkSync(tmpDevSql)}
    if(fs.existsSync(tmpProdSql)){fs.unlinkSync(tmpProdSql)}
    if(fs.existsSync(tmpRevertSql)){fs.unlinkSync(tmpRevertSql)}
    if(fs.existsSync(tmpDeploySql)){fs.unlinkSync(tmpDeploySql)}
  }
  
};

const getMigrationNumber = () => (new Date()).toISOString().slice(0, 19).replace(/[^0-9]/g,'')

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

const getTempPostgres = async (sqlDir, debug, dbDockerImage) => {
  const name = 'temp_postgres_' + Math.random().toString(36).substr(2, 5);
  const port = await getFreePort();
  const initSqlFile = `${sqlDir}/${INIT_SQL_FILENAME}`;
  writeInitSql(initSqlFile);
  let pgVersion = getPgVersion(DEV_DB_URI)
  let pgDockerImage = dbDockerImage ? dbDockerImage : `postgres:${pgVersion}`
  console.log(`Starting temporary PostgreSQL database with the version matching your dev database (${pgDockerImage})`)
  console.log(`on port ${port} with SQL from ${sqlDir}`)
  const cmd = 'docker',
        params = [ 
          "run", "-d",
          "--name", name,
          "-p", port+":5432", 
          //# env vars specific to postgres image used on first boot
          "-e", `POSTGRES_USER=${SUPER_USER}`,
          "-e", `POSTGRES_PASSWORD=${SUPER_USER_PASSWORD}`,
          "-e", `POSTGRES_DB=${DB_NAME}`,
          //# env vars useful for our sql scripts
          "-e", `SUPER_USER=${SUPER_USER}`,
          "-e", `SUPER_USER_PASSWORD=${SUPER_USER_PASSWORD}`,
          "-e", `DB_NAME=${DB_NAME}`,
          "-e", `DB_USER=${DB_USER}`,
          "-e", `DB_PASS=${DB_PASS}`,
          "-e", `DB_ANON_ROLE=${process.env.DB_ANON_ROLE}`,
          "-e", `DEVELOPMENT=${process.env.DEVELOPMENT}`,
          "-e", `JWT_SECRET=${process.env.JWT_SECRET}`,
          "-v", `${sqlDir}:/docker-entrypoint-initdb.d`,
          pgDockerImage
        ]
  if(debug){
    console.log("Starting temp contianer with:");
    console.log(`${cmd} ${params.join(' ')}`)
  }
  runCmd(cmd, params);

  
  return {containerName: name, dbUri: `postgres://${SUPER_USER}:${SUPER_USER_PASSWORD}@${LOCALHOST}:${port}/${DB_NAME}`, initSqlFile: initSqlFile};
}

const waitForDbContainer = (name, initSqlFile, debug) => {
  console.log(`Waiting for ${name} container to load`)
  let finishedLoading = false;
  let timestamp = 0;
  let iterations = 0;
  const maxIterations = 60;
  while( !finishedLoading ){
    iterations = iterations + 1;
    if( iterations > maxIterations ){
      break;
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
  if(fs.existsSync(initSqlFile)){fs.unlinkSync(initSqlFile)};

  if(finishedLoading){
    console.log('PostgreSQL init process complete; ready for start up.');
    if(debug){
      runCmd('docker', ['logs', name])
    }
  }
  else {
    runCmd('docker', ['logs', '--tail', '30', name])
    console.log('Gave up on waiting for db. The last 30 lines of log are above.');
    if(fs.existsSync(initSqlFile)){fs.unlinkSync(initSqlFile)};
  }
  
  return finishedLoading;
}

const initSqitch = () => runCmd(SQITCH_CMD, ["init", DB_NAME, "--engine", "pg"], {cwd: MIGRATIONS_DIR})

const addSqitchMigration = (name, note) => runCmd(SQITCH_CMD, ["add", name, "-n", note || `Add ${name} migration`], {cwd: MIGRATIONS_DIR})

const dumpSchema = (dbUri, file, diffRoles) => {
  console.log(`Writing database dump to ${file}`);
  const replace_superuser = new RegExp(`GRANT ([a-z0-9_-]+) TO ${SUPER_USER}`, "gi");
  if(diffRoles)  { runCmd(PG_DUMPALL_CMD, ['-f', `${file}.roles`, '--roles-only', '-d', dbUri]); }
  runCmd(PG_DUMP_CMD, [dbUri, '-f', `${file}.schema`, '--schema-only']);
  let data = [
		!diffRoles ? '' : fs.readFileSync(`${file}.roles`, 'utf-8')
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
  if(diffRoles) { fs.unlinkSync(`${file}.roles`); }
  fs.unlinkSync(`${file}.schema`);
}

const apgdiffToFile = (file1, file2, destFile) => {
  let cmd = JAVA_CMD
  let params = ['-jar', APGDIFF_JAR_PATH, '--add-transaction', file1, file2]
  let options = {}
  if(USE_DOCKER_IMAGE && [SQITCH_CMD, PG_DUMP_CMD, PG_DUMPALL_CMD, JAVA_CMD].indexOf(cmd) !== -1){
    //alter the command to run in docker
    let w = (options && options.cwd) ? options.cwd.replace(APP_DIR, DOCKER_APP_DIR) : DOCKER_APP_DIR;
    params = ['run', '--rm', '-w', w, '-v', `${APP_DIR}:${DOCKER_APP_DIR}`, DOCKER_IMAGE, cmd]
      .concat(params.map(p => p.replace(APP_DIR, DOCKER_APP_DIR)));
    cmd = 'docker';
  }
  console.log(`Diffing ${file1} and ${file2}`);
  console.log(`Writing the result to ${destFile}`);
  let p = proc.spawnSync(cmd, params, options);
  if(p.stdout.toString())
    fs.writeFileSync(destFile, p.stdout.toString());
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

const getPgVersion = (dbUri) =>{
  const env = Object.create( process.env ),
        result = runCmd(PSQL_CMD, ['--quiet', '--tuples-only', '-c', 'show server_version', dbUri], { env: env }, true, false).stdout.toString().trim();
  let pgVersion = '11.3';
  if(result.indexOf(' ') !== -1){
    pgVersion = result.substr(0, result.indexOf(' ')); 
  }
  return pgVersion;
}

program
  .command('init')
  .option("--debug", "Verbose output and leaves the temporary files (used to create the migration) in place")
  .option("--db-docker-image <image>", "DOcker image used for temp postgres")
  .description('Setup sqitch config and create the first migration')
  .action((options) => { checkIsAppDir(); initMigrations(options.debug, options.dbDockerImage);});

program
  .command('add <name>')
  .option("-n, --note <note>", "Add sqitch migration note")
  .option("-d, --no-diff", "Add empty sqitch migration (no diff)")
  .option("--no-roles", "Do not include ROLE create/drop statements")
  .option("--dry-run", "Don not create migrations files, only output the diff")
  .option("--debug", "Verbose output and leaves the temporary files (used to create the migration) in place")
  .option("--db-uri <uri>", "Diff against a database schema (By default we diff src/ and migrations/deploy/ directories)")
  .option("--db-docker-image <image>", "Docker image used for temp postgres")
  .description('Adds a new sqitch migration')
  .action((name, options) => {
      checkIsAppDir();
      addMigration(name, options.note, options.diff, options.dryRun, options.debug, options.dbUri, options.dbDockerImage, options.roles);
  });


program
  .command('deploy <url>')
  .description('Deploy sqitch migrations to a production database, url must have the `db:pg://${user}:${pass}@${host}:${port}/${db}` format')
  .action( url => {
    checkIsAppDir();
    checkMigrationsInitiated();
    sqitchDeploy(url);
  });

program.parse(process.argv);
