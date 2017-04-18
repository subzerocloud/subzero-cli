require('dotenv').config(); //.env file vars added to process.env

const blessed   = require('blessed')
const proc      = require('child_process');
const highlight = require('cli-highlight').highlight;
const decoder   = new (require('string_decoder').StringDecoder)('utf8');
const watcher = require('chokidar');

const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;

if(!COMPOSE_PROJECT_NAME){
  console.log("\x1b[31mError:\x1b[0m You must set the COMPOSE_PROJECT_NAME var in the .env file");
  process.exit(0);
}

let screen = blessed.screen({
  smartCSR: true,
  autoPadding: false,
  warnings: true
});

let pgLogger = blessed.log({
  label: "PostgreSQL",
  parent: screen,
  top: 0,
  left: 0,
  width: '60%',
  height: '80%',
  border: 'line',
  keys: true,
  vi: true,
  mouse: true,
  scrollback: 100,
  scrollbar: {
    ch: ' ',
    style: {
      inverse: true
    }
  }
});

let pgLogsProc = proc.spawn('docker',['logs', '-f', `${COMPOSE_PROJECT_NAME}_db_1`]);
pgLogsProc.stderr.on('data', (data) => {
  pgLogger.log(highlight(decoder.write(data), { language : 'sql'}));
});

let openRestyLogger = blessed.log({
  label: "OpenResty",
  parent: screen,
  top: 0,
  left: '60%',
  width: '40%',
  height: '80%',
  border: 'line',
  keys: true,
  vi: true,
  mouse: true,
  scrollback: 100,
  scrollbar: {
    style: {
      inverse: true
    }
  }
});

let oRestyLogsProc = proc.spawn('docker',['logs', '-f', `${COMPOSE_PROJECT_NAME}_openresty_1`]);
oRestyLogsProc.stdout.on('data', (data) => {
  let res = highlight(decoder.write(data), { language : 'accesslog'})
           .replace(/<span class=\"hljs-string\">/g, '').replace(/<\/span>/g, '');
  openRestyLogger.log(res);
});

let pgReloaderLogger = blessed.log({
  label: "File Watcher",
  parent: screen,
  top: "80%",
  left: 0,
  width: '100%',
  height: '20%',
  border: 'line',
  keys: true,
  vi: true,
  mouse: true,
  scrollback: 100,
  scrollbar: {
    style: {
      inverse: true
    }
  }
});

const POSTGRES_USER = process.env.POSTGRES_USER;
const DB_NAME = process.env.DB_NAME;
const DB_DIR = "docker-entrypoint-initdb.d/";

let pgReloaderProc = path => proc.spawn('docker',['exec', `${COMPOSE_PROJECT_NAME}_db_1`, 'psql', '-U', POSTGRES_USER, DB_NAME, '-c', `\\i ${path}`]);

watcher.watch(['sql/**/*.sql'], {persistent: true})
	.on('change', path => {
		let proc = pgReloaderProc(path.replace('sql/', DB_DIR));
		pgReloaderLogger.log(`${path} changed`);
		proc.stdout.on('data', data => pgReloaderLogger.log(highlight(decoder.write(data), { language : 'sql'})));
		proc.stderr.on('data', data => pgReloaderLogger.log(highlight(decoder.write(data), { language : 'sql'})));
	})
	.on('ready', () => pgReloaderLogger.log('Watching sql/ directory for changes'));

screen.render();

screen.key(['escape', 'q', 'C-c'], () => {
  return process.exit(0);
});
