#!/usr/bin/env node
"use strict";

import program from 'commander';
import proc from 'child_process';
import fs from 'fs';
import sleep from 'sleep';
import rimraf from 'rimraf';
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
    LOCALHOST,
    SQL_DIFF_TOOL,
    MIGRA_CMD,
    SQLWORKBENCH_JAR_PATH,
    SQLWORKBENCH_CMD,
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

const initMigrations = async (debug, dbDockerImage, dryRun, diffTool, includeRoles, includePrivileges) => {

  if (fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`Migrations directory already exists: ${MIGRATIONS_DIR}`);
    process.exit(-1);
  }

  let   tempDevDbUri = null,
        tempProdDbUri = null,
        tempProdDbcontainerName = null;
  const name = INITIAL_FILE_NAME,
        DIFF_TOOL = diffTool?diffTool:SQL_DIFF_TOOL,
        migrationNumber = getMigrationNumber(),
        tmpDevSql = `${TMP_DIR}/${migrationNumber}-dev-${name}.sql`,
        tmpProdSql = `${TMP_DIR}/${migrationNumber}-prod-${name}.sql`,
        tmpDeploySql = `${TMP_DIR}/${migrationNumber}-deploy-${name}.sql`,
        tmpRevertSql = `${TMP_DIR}/${migrationNumber}-revert-${name}.sql`;

  fs.mkdirSync(MIGRATIONS_DIR);
  fs.mkdirSync(TMP_DIR);
  initSqitch();

  const {containerName: devDbcontainerName, dbUri: devDbUri, initSqlFile: devInitSqlFile} = await getTempPostgres(DB_DIR, debug, dbDockerImage);
  const devDbContianerReady = waitForDbContainer(devDbcontainerName, devInitSqlFile, debug);
  if(!devDbContianerReady){
    stopContainer(devDbcontainerName);
    rimraf.sync(MIGRATIONS_DIR);
    process.exit(-1); 
  }
  tempDevDbUri = devDbUri;
  dumpSchema(devDbUri, tmpDevSql, includeRoles, includePrivileges);
  fs.closeSync(fs.openSync(tmpProdSql, 'w'));

  if(DIFF_TOOL!=='apgdiff'){
    const {containerName: prodDbcontainerName, dbUri: prodDbUri, initSqlFile: prodInitSqlFile} = await getTempPostgres(`${MIGRATIONS_DIR}/deploy`, debug, dbDockerImage);
    const prodDbContianerReady = waitForDbContainer(prodDbcontainerName, prodInitSqlFile, debug);
    if(!prodDbContianerReady){
      stopContainer(devDbcontainerName);
      stopContainer(prodDbcontainerName);
      rimraf.sync(MIGRATIONS_DIR);
      process.exit(-1); 
    }
    tempProdDbUri = prodDbUri;
    tempProdDbcontainerName = prodDbcontainerName;
  }
  
  // in this case, the database dump is the initial migration
  // we only generate the revert migration
  switch (DIFF_TOOL){
    case 'apgdiff':
      //apgdiffToFile(tmpProdSql, tmpDevSql, tmpDeploySql);
      apgdiffToFile(tmpDevSql, tmpProdSql, tmpRevertSql);
      break;
    case 'migra':
      //migraToFile(tempProdDbUri, tempDevDbUri, tmpDeploySql, includeRoles, includePrivileges);
      migraToFile(tempDevDbUri, tempProdDbUri, tmpRevertSql, false, false);
      break;
    // case 'sqlworkbench':
    //   sqlworkbenchFile(tempDevDbUri, tempProdDbUri, tmpDeploySql, includeRoles, includePrivileges);
    //   sqlworkbenchFile(tempProdDbUri, tempDevDbUri, tmpRevertSql, includeRoles, includePrivileges);
    //   break;
  }

  stopContainer(devDbcontainerName);
  if(tempProdDbUri){
    stopContainer(tempProdDbcontainerName);
  }

  addSqitchMigration(`${migrationNumber}-${name}`);

  console.log(`Copying ${tmpDevSql.replace(APP_DIR,'')} to ${MIGRATIONS_DIR.replace(APP_DIR,'')}/deploy/${migrationNumber}-${name}.sql`);
  fs.copyFileSync(tmpDevSql, `${MIGRATIONS_DIR}/deploy/${migrationNumber}-${name}.sql`);
  if(fs.existsSync(tmpRevertSql)){
    fs.copyFileSync(tmpRevertSql, `${MIGRATIONS_DIR}/revert/${migrationNumber}-${name}.sql`);
  }
  else{console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", `${migrationNumber}-revert-${name}.sql`);}



  if(!debug){
    if(fs.existsSync(tmpDevSql)){fs.unlinkSync(tmpDevSql)}
    if(fs.existsSync(tmpProdSql)){fs.unlinkSync(tmpProdSql)}
    if(fs.existsSync(tmpRevertSql)){fs.unlinkSync(tmpRevertSql)}
    if(fs.existsSync(tmpDeploySql)){fs.unlinkSync(tmpDeploySql)}
  }

  if(dryRun){
    //we just delete the dir
    rimraf.sync(MIGRATIONS_DIR);
  }
};

const addMigration = async (name, note, diff, dryRun, debug, dbUri, dbDockerImage, diffTool, includePrivileges) => {

  if (!fs.existsSync(SQITCH_CONF) || !fs.statSync(SQITCH_CONF).isFile()){
    console.log("\x1b[31mError:\x1b[0m the file '%s' does not exist", SQITCH_CONF);
    console.log("You need to run 'subzero migrations init'");
    process.exit(-1);
  }
  if(dbUri){
    checkPostgresConnection(dbUri, '');
  }
  const migrationNumber = getMigrationNumber(),
        tmpDevSql = `${TMP_DIR}/${migrationNumber}-dev-${name}.sql`,
        tmpProdSql = `${TMP_DIR}/${migrationNumber}-prod-${name}.sql`,
        tmpDeploySql = `${TMP_DIR}/${migrationNumber}-deploy-${name}.sql`,
        tmpRevertSql = `${TMP_DIR}/${migrationNumber}-revert-${name}.sql`,
        DIFF_TOOL = diffTool?diffTool:SQL_DIFF_TOOL;
  if( diff ){
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
    let tempDevDbUri = null,
        tempProdDbUri = null,
        tempProdDbcontainerName = null;
    const {containerName: devDbcontainerName, dbUri: devDbUri, initSqlFile: devInitSqlFile} = await getTempPostgres(DB_DIR, debug, dbDockerImage);
    const devDbContianerReady = waitForDbContainer(devDbcontainerName, devInitSqlFile, debug);
    if(!devDbContianerReady){
      stopContainer(devDbcontainerName);
      process.exit(-1); 
    }
    tempDevDbUri = devDbUri;
    if(DIFF_TOOL=='apgdiff'){dumpSchema(devDbUri, tmpDevSql, false, includePrivileges);}
    

    if(dbUri){
      tempProdDbUri = dbUri;
      if(DIFF_TOOL=='apgdiff'){dumpSchema(dbUri, tmpProdSql, false, includePrivileges);}
    }
    else{
      const {containerName: prodDbcontainerName, dbUri: prodDbUri, initSqlFile: prodInitSqlFile} = await getTempPostgres(`${MIGRATIONS_DIR}/deploy`, debug, dbDockerImage);
      const prodDbContianerReady = waitForDbContainer(prodDbcontainerName, prodInitSqlFile, debug);
      if(!prodDbContianerReady){
        stopContainer(devDbcontainerName);
        stopContainer(prodDbcontainerName);
        process.exit(-1); 
      }
      if(DIFF_TOOL=='apgdiff'){dumpSchema(prodDbUri, tmpProdSql, false, includePrivileges);}
      tempProdDbUri = prodDbUri;
      tempProdDbcontainerName = prodDbcontainerName;
    }
   
    switch (DIFF_TOOL){
      case 'apgdiff':
        apgdiffToFile(tmpDevSql, tmpProdSql, tmpRevertSql);
        apgdiffToFile(tmpProdSql, tmpDevSql, tmpDeploySql);
        break;
      case 'migra':
        migraToFile(tempProdDbUri, tempDevDbUri, tmpDeploySql, false, includePrivileges);
        migraToFile(tempDevDbUri, tempProdDbUri, tmpRevertSql, false, includePrivileges);
        break;
      // case 'sqlworkbench':
      //   sqlworkbenchFile(tempDevDbUri, tempProdDbUri, tmpDeploySql, includeRoles, includePrivileges);
      //   sqlworkbenchFile(tempProdDbUri, tempDevDbUri, tmpRevertSql, includeRoles, includePrivileges);
      //   break;
    }

    stopContainer(devDbcontainerName);
    if(!dbUri){
      stopContainer(tempProdDbcontainerName);
    }
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
  console.log(`on port ${port} with SQL from ${sqlDir.replace(APP_DIR,'')}`)
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

  
  return {
    containerName: name, 
    dbUri: `postgresql://${SUPER_USER}:${SUPER_USER_PASSWORD}@${LOCALHOST}:${port}/${DB_NAME}`,
    initSqlFile: initSqlFile
  };
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
    let p0 = proc.spawnSync('docker', ['ps', '-a', '--filter', `name=${name}`, '--format', '"{{.Status}}"']);
    
    let output = p0.output.map(l => l?l.toString():'').join(' ');
    if(output.indexOf('Exited') !== -1){
      //container has exited with an error, no point in waiting
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
    console.log('\x1b[31mError:\x1b[0m Gave up on waiting for db. The last 30 lines of log are above.');
    if(fs.existsSync(initSqlFile)){fs.unlinkSync(initSqlFile)};
  }
  
  return finishedLoading;
}

const initSqitch = () => runCmd(SQITCH_CMD, ["init", DB_NAME, "--engine", "pg"], {cwd: MIGRATIONS_DIR})

const addSqitchMigration = (name, note) => runCmd(SQITCH_CMD, ["add", name, "-n", note || `Add ${name} migration`], {cwd: MIGRATIONS_DIR})

const dumpRoles = (dbUri, file) => {
  console.log(`Writing database roles dump to ${file.replace(APP_DIR,'')}`);
  const replace_superuser = new RegExp(`GRANT ([a-z0-9_-]+) TO ${SUPER_USER}`, "gi");
  runCmd(PG_DUMPALL_CMD, ['-f', `${file}`, '--roles-only', '-d', dbUri]);
  
  // we need some small postprocessing 
  let data = fs.readFileSync(`${file}`, 'utf-8')
    .split("\n")
    .filter(ln => IGNORE_ROLES.map(r => ln.indexOf('ROLE '+r)).every(p => p == -1) ) //filter out line referring to ignored roles
    .map(ln => ln.replace(` GRANTED BY ${SUPER_USER}`, '')) //remove unwanted string
    .filter(ln => ln.indexOf('ALTER ROLE') == -1) //RDS does not allow this
    .map(ln => ln.replace(replace_superuser, 'GRANT $1 TO current_user'))
    .join("\n");
  fs.writeFileSync(file, data, 'utf-8');
}

const dumpSchema = (dbUri, file, includeRoles, includePrivileges) => {
  console.log(`Writing database dump to ${file.replace(APP_DIR,'')}`);
  if(includeRoles)  { 
    dumpRoles(dbUri, `${file}.roles`)
  }
  let params = [dbUri, '-f', `${file}.schema`, '--schema-only'];
  if(!includePrivileges){
    params.push('--no-privileges');
  }
  runCmd(PG_DUMP_CMD, params);
  let data = [
    '-- generated with subzero-cli (https://github.com/subzerocloud/subzero-cli)',
    'BEGIN;',
		!includeRoles ? '' : fs.readFileSync(`${file}.roles`, 'utf-8'),
    fs.readFileSync(`${file}.schema`, 'utf-8')
      .split("\n")
      .filter(ln => ln.indexOf('COMMENT ON EXTENSION') == -1) //RDS does not allow this
      .filter(ln => ln.indexOf(`OWNER TO ${SUPER_USER};`) == -1) //don't keep owner info when the owner is privileges
      .join("\n"),
    'COMMIT;',
  ];
  fs.writeFileSync(file, data.join("\n"), 'utf-8');
  if(includeRoles) { fs.unlinkSync(`${file}.roles`); }
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
  console.log(`Diffing ${file1.replace(APP_DIR,'')} and ${file2.replace(APP_DIR,'')}`);
  console.log(`Writing the result to ${destFile.replace(APP_DIR,'')}`);
  let p = proc.spawnSync(cmd, params, options);
  if(p.stdout.toString()){
    fs.writeFileSync(destFile, p.stdout.toString());
    fs.writeFileSync(destFile, 
      [
        '-- generated with subzero-cli (https://github.com/subzerocloud/subzero-cli)',
        p.stdout.toString(),
      ].join("\n")
    );
  }
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

// const diffRoles = (dburl_from, dburl_target, destFile) => {
//   dumpRoles(dburl_from, `${destFile}.roles_from`);
//   dumpRoles(dburl_target, `${destFile}.roles_target`);
//   apgdiffToFile(`${destFile}.roles_target`,
//                 `${destFile}.roles_from`,
//                 `${destFile}`);
//   fs.unlinkSync(`${destFile}.roles_from`);
//   fs.unlinkSync(`${destFile}.roles_target`);
// }

const migraToFile = (dburl_from, dburl_target, destFile, includeRoles, includePrivileges) => {
  let cmd = MIGRA_CMD
  let params = ['--unsafe'];
  if(includePrivileges){
    params.push('--with-privileges')
  }
  params.push(dburl_from);
  params.push(dburl_target);
  let options = {}
  console.log(`Diffing databases using migra`);
  console.log(`Writing the result to ${destFile.replace(APP_DIR,'')}`);
  let p = runCmd(cmd, params, options, false, false, false, ['ignore', 'pipe', 'pipe'])
  if(p.stdout.toString()){
    let roles = '';
    if(includeRoles){
      //diffRoles(dburl_from, dburl_target, `${destFile}.roles`)
      dumpRoles(dburl_from, `${destFile}.roles`);
      roles = fs.readFileSync(`${destFile}.roles`, 'utf-8');
      fs.unlinkSync(`${destFile}.roles`);
    }
    fs.writeFileSync(destFile, 
      [
        '-- generated with subzero-cli (https://github.com/subzerocloud/subzero-cli)',
        'BEGIN;',
        roles,
        p.stdout.toString(),
        'COMMIT;',
      ].join("\n")
    );
  }
  if(p.stderr.toString())
    console.log(p.stderr.toString());
};

// const sqlworkbenchFile = (dburl_from, dburl_target, destFile, includeRoles, includePrivileges) => {
  
//   let cmd = JAVA_CMD
//   let splitConnectionString = new RegExp('postgresql:\/\/([^:]+):([^@]+)@(([^\/]+)\/([^?]+))')
//   let m1 = dburl_from.match(splitConnectionString)
//   let m2 = dburl_target.match(splitConnectionString)
//   let driver = "/usr/local/lib/postgresql-42.2.18.jar"
//   let options = {}
  
//   const DBURL_FROM = `driverjar=${driver},username=${m1[1]},password=${m1[2]},url=jdbc:postgresql://${m1[3]}`
//   const DBURL_TARGET = `driverjar=${driver},username=${m2[1]},password=${m2[2]},url=jdbc:postgresql://${m2[3]}`
//   const DEST_FILE = destFile+'.xml'
//   let WBCMD=[
//     'WbSchemaDiff',
//     '-styleSheet=wbdiff2pg.xslt',
//     `-referenceConnection="${DBURL_FROM}"`,
//     `-targetConnection="${DBURL_TARGET}"`,
//     `-file=${DEST_FILE}`,
//     `-xsltOutput=${destFile}`,
//     '-referenceSchema=*',
//     '-targetSchema=*',
//     '-includeViews=true',
//     '-includeProcedures=true',
//     '-includeIndex=true',
//   ]
  
//   if(includePrivileges){
//     console.log(`\x1b[31msqlworkbench has only partial support for --with-privileges\x1b[0m`);
//     WBCMD.push('-includeTableGrants=true')
//   }
//   let sqlworkbench_command="-command='"+WBCMD.join(' ') +" ;'";
//   let params = ['-jar', SQLWORKBENCH_JAR_PATH, sqlworkbench_command]
//   console.log(params)
//   console.log(`Diffing databases using sqlworkbench`);
//   console.log(`Writing the result to ${destFile}`);
//   let p = runCmd(cmd, params, options, false, false, false, ['ignore', 'pipe', 'pipe'])
//   if(p.stdout.toString()){
//     let roles = '';
//     if(includeRoles){
//       diffRoles(dburl_from, dburl_target, `${destFile}.roles`)
//       roles = fs.readFileSync(`${destFile}.roles`, 'utf-8');
//       fs.unlinkSync(`${destFile}.roles`);
//     }
//     fs.writeFileSync(destFile, roles + "\n" + p.stdout.toString());
//   }
//   if(p.stderr.toString())
//     console.log(p.stderr.toString());

//   if(fs.existsSync(destFile+'.xml')){fs.unlinkSync(destFile+'.xml')}
// };

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
  .option("--db-docker-image <image>", "Docker image used for temp postgres")
  .option("--dry-run", "Don not create migrations files")
  .option("--diff-tool <diff-tool>", "Use apgdiff, migra, sqlworkbench for diffing")
  .option("--with-roles", "Include ROLE create/drop statements")
  .option("--with-privileges", "Include grant/revoke commands")
  .description('Setup sqitch config and create the first migration')
  .action((options) => { 
    checkIsAppDir();
    initMigrations(options.debug, options.dbDockerImage, options.dryRun, options.diffTool, options.withRoles, options.withPrivileges);
  });

program
  .command('add <name>')
  .option("-n, --note <note>", "Add sqitch migration note")
  .option("-d, --no-diff", "Add empty sqitch migration (no diff)")
  .option("--diff-tool <diff-tool>", "Use apgdiff, migra, sqlworkbench for diffing")
  .option("--with-privileges", "Include grant/revoke commands (experimental)")
  .option("--dry-run", "Don not create migrations files, only output the diff")
  .option("--debug", "Verbose output and leaves the temporary files (used to create the migration) in place")
  .option("--db-uri <uri>", "Diff against a database schema (By default we diff src/ and migrations/deploy/ directories)")
  .option("--db-docker-image <image>", "Docker image used for temp postgres")
  .description('Adds a new sqitch migration')
  .action((name, options) => {
      checkIsAppDir();
      if(options.withPrivileges){
        console.log(`\x1b[31mWARNING: --with-privileges is an experimental feature and the output is incomplete, do not rely on it\x1b[0m`);
      }
      addMigration(name, options.note, options.diff, options.dryRun, options.debug, options.dbUri, options.dbDockerImage, options.diffTool, options.withPrivileges);
  });

program
  .command('sqitch')
  .description('run embeded sqitch')
  .allowUnknownOption()
  .action( () => {
    const sqitchParamas = process.argv.slice(process.argv.indexOf('sqitch')+1);
    runCmd(SQITCH_CMD, sqitchParamas, {cwd: process.cwd()})
  }).on('--help', function() {
    runCmd(SQITCH_CMD, ['--help'], {cwd: process.cwd()})
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
