#!/usr/bin/env node
"use strict";

import proc from 'child_process';
import {highlight} from 'cli-highlight';
import {StringDecoder} from 'string_decoder'; 
import {config} from 'dotenv';
import chokidar from 'chokidar';

import React, {Component} from 'react';
import blessed from 'blessed';
import {render} from 'react-blessed';

import {version} from '../package.json';

config();//.env file vars added to process.env 

const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;
const POSTGRES_USER = process.env.POSTGRES_USER;
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_DIR = "docker-entrypoint-initdb.d/";

if(!COMPOSE_PROJECT_NAME){
  console.log("\x1b[31mError:\x1b[0m You must set the COMPOSE_PROJECT_NAME var in the .env file");
  process.exit(0);
}

const PG = `${COMPOSE_PROJECT_NAME}_db_1`
const PGREST = `${COMPOSE_PROJECT_NAME}_postgrest_1`;
const RMQ = `${COMPOSE_PROJECT_NAME}_rabbitmq_1`;
const OPENRESTY = `${COMPOSE_PROJECT_NAME}_openresty_1`;

//Processes that output the full log, only used on start
const logsProc = container => proc.spawn('docker',['logs', '-f', container]);
const pgLogsProc = logsProc(PG);
const pgRestLogsProc = logsProc(PGREST);
const oRestyLogsProc = logsProc(OPENRESTY);
const rmqLogsProc = logsProc(RMQ);

//Processes that output the tail of log, used for showing the logs after container restart to avoid showing the log from the beginning
const logsTailProc = (container, succ, err) => {
  let p = proc.spawn('docker',['logs', '-f', '--tail=1', container]);
  p.stdout.on('data', succ);
  p.stderr.on('data', err);
  return p;
}
let pgTailProc = null;
let pgRestTailProc = null;
let oRestyTailProc = null;
let rmqTailProc = null;

//File Watcher actions
let watcher = null;
const watch = () => chokidar.watch(['**/*.sql', '**/*.lua', '**/*.conf'], { ignored : '**/tests/**'});
const pgReloaderProc = path => proc.spawn('docker',['exec', PG, 'psql', '-U', POSTGRES_USER, DB_NAME, '-c', `\\i ${path}`]);
const hupperProc = container => proc.spawn('docker',['kill', '-s', 'HUP', container]);
const restartProc = (container, succ, err) => {
  let p = proc.spawn('docker',['restart', container]);
  p.stdout.on('data', succ);
  p.stderr.on('data', err);
}

const resetDBProc = () => {
  //Ideally all this statements should all be executed in a single command, but doing multiple commands in a psql session is
  //currently not possible because docker exec -ti doesn't give a tty https://github.com/moby/moby/issues/8755
  //and stdin cannot be used.
  let p1 = proc.spawn('docker',['exec', PG, 'psql', '-U', POSTGRES_USER, 'postgres', '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}'`]);
  p1.stdout.on('data', data => {
    let p2 = proc.spawn('docker',['exec', PG, 'psql', '-U', POSTGRES_USER, 'postgres', '-c',
      `DROP DATABASE if exists ${DB_NAME}`]);
    p2.stdout.on('data', data => {
      let p3 = proc.spawn('docker',['exec', PG, 'psql', '-U', POSTGRES_USER, 'postgres', '-c',
        `CREATE DATABASE ${DB_NAME}`]);
      p3.stdout.on('data', data => {
        pgReloaderProc(`${DB_DIR}/init.sql`).stdout.on('data', data => {
          hupperProc(PGREST);
          hupperProc(OPENRESTY);
        });
      });
    });
  });
};

const decoder = new StringDecoder('utf8');
//Workaround for a bug in the highlighting lib
const printLog = data => highlight(decoder.write(data), {language : 'accesslog'}).replace(/<span class=\"hljs-string\">/g, '').replace(/<\/span>/g, '');
const printSQL = data => highlight(decoder.write(data), {language : 'sql'});

class Dashboard extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      curIdx : 0,
			hidden : [false, true, true, true],
      restarted : [false, false, false, false],
      stoppedWatcher : false,
      startedWatcher : false,
      hiddenHelp : true
		};
  }
  componentDidMount(){
    this.refs.mainEl.on("element keypress", (el, ch, key) => this.handleKeyPress(key.full));
  }
  handleKeyPress = (key) => {
    if(key == "left" || key == "right"){
      const {hidden} = this.state;
      // Hide current log
      let idx = hidden.findIndex( x => !x );
      hidden[idx] = true;
      // Show next log and iterate circularly
      if(key == "left")
        idx = (idx - 1 == -1)?(hidden.length - 1):(idx - 1);
      if(key == "right")
        idx = (idx + 1 == hidden.length)?0:(idx + 1);
      hidden[idx] = false;
      this.setState({hidden: hidden, curIdx: idx});
    }
    if(key == '2'){
      this.restartContainer();
    }
    if(key == '3'){
      this.restartAllContainers();
    }
    if(key == '4'){
      this.stopWatcher();
    }
    if(key == '5'){
      this.startWatcher();
    }
    if(key == '6'){
      this.resetDB();
    }
    if(key == '?' || key == 'h'){
      this.hideHelp();
    }
  }
  restartContainer = () => {
    const {curIdx, restarted} = this.state;
    restarted[curIdx] = true;
    this.setState({restarted : restarted});
    this.clearRestarts();
  }
  restartAllContainers = () => {
    this.setState({restarted : [true, true, true, true]});
    this.clearRestarts();
  }
  clearRestarts = () => this.setState({restarted : [false, false, false, false]}) // To prevent re-restarting
  stopWatcher = () => {
    this.setState({stoppedWatcher : true});
    this.setState({stoppedWatcher : false}); // To prevent re-stopping
  }
  startWatcher = () => {
    this.setState({startedWatcher : true});
    this.setState({startedWatcher : false}); // To prevent re-starting
  }
  resetDB = () => {
    resetDBProc();
  }
  hideHelp = () => {
    this.setState( (prevState, props) => ({hiddenHelp : !prevState.hiddenHelp}));
  }
  render() {
    const { hidden, restarted, stoppedWatcher, startedWatcher, hiddenHelp } = this.state;
    const { restartContainer, restartAllContainers, stopWatcher, startWatcher, resetDB, hideHelp } = this;
    const listStyle = {
      mouse: true,
      keys: true,
      vi: true,
      left: 0,
      top: 0,
      padding :{
        top: 1
      },
      bottom: 0,
      width: "9%",
      align: 'center',
      tags: true,
      items: ['PostgreSQL', 'PostgREST', 'OpenResty', 'RabbitMQ', 'Watcher /'],
      style: {
        selected:{
          fg: "green"
        },
        item: {
          fg: "grey",
          hover:{
            fg: "light-blue"
          }
        }
      }
    };
    const lineStyle = {
      orientation: 'vertical',
      left: "9%",
      top: 0,
      bottom: 0,
      fg: "blue"
    };
    return (
      <element keyable={true} ref="mainEl">
        <list class={listStyle}/>
        <line class={lineStyle}/>
        <PgLog restart={restarted[0]} hidden={hidden[0]}/>
        <ORestyLog restart={restarted[1]} hidden={hidden[1]}/>
        <PgRESTLog restart={restarted[2]} hidden={hidden[2]}/>
        <RMQLog restart={restarted[3]} hidden={hidden[3]}/>
        <Options restartContainer={restartContainer} restartAllContainers={restartAllContainers} 
          stopWatcher={stopWatcher} startWatcher={startWatcher} resetDB={resetDB} hideHelp={hideHelp}/>
        <Help hidden={hiddenHelp}/>
      </element>
    );
  }
}

const logStyle = {
	keys: true,
	vi: true,
  left: "10%",
	mouse: true,
  scrollback: 95,
	scrollbar: {
		ch: ' ',
		style: {
			inverse: true
		}
	},
	border: {
		type: 'line',
    fg: 'green'
	},
  width: "90%",
  height: "97%"
};

class PgLog extends Component {
  componentWillReceiveProps(nextProps){
    const logger = this.refs.pgLog;
    if(nextProps.restart){
      logger.log(`Restarting ${PG} ...`);
      restartProc(PG, 
        data => {
          logger.log("Done");
          pgTailProc = logsTailProc(PG, data => logger.log(printSQL(data)),
                                        data => logger.log(printSQL(data)));
        },
        data => logger.log(printSQL(data)));
    }
  }
	componentDidMount(){
    const logger = this.refs.pgLog;
		pgLogsProc.stdout.on('data', data => logger.log(printSQL(data)));
		pgLogsProc.stderr.on('data', data => logger.log(printSQL(data)));
	}
  render(){
    const {hidden} = this.props;
    return (
      <log onRestart={this.handleRestart} hidden={hidden} ref="pgLog" label=" Logs " class={logStyle}/>
    );
  }
}

class ORestyLog extends Component {
  componentWillReceiveProps(nextProps){
    const logger = this.refs.oRestyLog;
    if(nextProps.restart){
      logger.log(`Restarting ${OPENRESTY} ...`);
      restartProc(OPENRESTY, 
        data => {
          logger.log("Done");
          oRestyTailProc = logsTailProc(OPENRESTY, data => logger.log(printLog(data)),
                                                   data => logger.log(printLog(data)));
        },
        data => logger.log(printLog(data)));
      
    }
  }
	componentDidMount(){
    const logger = this.refs.oRestyLog;
		oRestyLogsProc.stdout.on('data', data => logger.log(printLog(data)));
		oRestyLogsProc.stderr.on('data', data => logger.log(printLog(data)));
	}
  render() {
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="oRestyLog" label="Logs OpenResty" class={logStyle}/>
    );
  }
}

class RMQLog extends Component {
  componentWillReceiveProps(nextProps){
    const logger = this.refs.rmqLog;
    if(nextProps.restart){
      logger.log(`Restarting ${RMQ} ...`);
      restartProc(RMQ, 
        data => {
          logger.log("Done");
          rmqTailProc = logsTailProc(RMQ, data => logger.log(printLog(data)),
                                          data => logger.log(printLog(data)));
        },
        data => logger.log(printLog(data)));
    }
  }
	componentDidMount(){
		rmqLogsProc.stdout.on('data', data => this.refs.rmqLog.log(printLog(data)));
		rmqLogsProc.stderr.on('data', data => this.refs.rmqLog.log(printLog(data)));
	}
  render() {
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="rmqLog" label="Logs RabbitMQ" class={logStyle}/>
    );
  }
}

class PgRESTLog extends Component {
  componentWillReceiveProps(nextProps){
    const logger = this.refs.pgRestLog;
    if(nextProps.restart){
      logger.log(`Restarting ${PGREST} ...`);
      restartProc(PGREST, 
        data => {
          logger.log("Done");
          pgRestTailProc = logsTailProc(PGREST, data => logger.log(printLog(data)),
                                                data => logger.log(printLog(data)));
        },
        data => logger.log(printLog(data)));
    }
  }
	componentDidMount(){
		pgRestLogsProc.stdout.on('data', data => this.refs.pgRestLog.log(printLog(data)));
		pgRestLogsProc.stderr.on('data', data => this.refs.pgRestLog.log(printLog(data)));
	}
  render() {
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="pgRestLog" label="Logs PostgREST" class={logStyle}/>
    );
  }
}

class WatcherLog extends Component {
  componentWillReceiveProps(nextProps){
    let logger = this.refs.watcherLog;
    if(nextProps.stopped){
      watcher.close();
      logger.log("Watcher stopped");
    }
    if(nextProps.started){
      watcher.close(); //Prevent previous watcher from rewatching
      watcher = watch();
      logger.log("Watcher started");
      this.watcherActions();
    }
  }
  watcherActions = () => {
    let logger = this.refs.watcherLog;
    watcher
      .on('change', path => {
        logger.log(`${path} changed`);
        if(path.endsWith(".sql")){
          let p = pgReloaderProc(path.replace('sql/', DB_DIR));
          p.stdout.on('data', data => logger.log(printSQL(data)));
          p.stderr.on('data', data => logger.log(printSQL(data)));
        }else{
          let p = hupperProc(OPENRESTY);
          p.stdout.on('data', data => logger.log("Nginx restarted"));
        }
      })
      .on('ready', () => logger.log('Watching sql/ directory for changes', 
                                    'Watching nginx/ directory for changes',
                                    'Watching lua/ directory for changes'));
  }
	componentDidMount(){
    watcher = watch();
    this.watcherActions();
	}
  render() {
    const watcherLogStyle = {
      keys: true,
      vi: true,
      mouse: true,
      scrollback: 95,
      scrollbar: {
        ch: ' ',
        style: {
          inverse: true
        }
      },
      border: {
        type: 'line'
      },
      left: "70%",
      width: "30%",
      height: "95%"
    };
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="watcherLog" label="Watcher" class={watcherLogStyle}
           />
    );
  }
}

class Options extends Component {
  render(){
    const buttonStyle = {
      //border: {
        //type: 'line'
      //},
      style: {
        border: {
          fg: 'blue'
        }
      },
      tags: true,
      padding: {
        top: 0,
        bottom: 0,
        left: 2,
        right: 2
      }
    };
    const {restartContainer, restartAllContainers, stopWatcher, startWatcher, resetDB, hideHelp} = this.props;
    return (
      <layout left="10%" top="97%" width="90%" height="3%">
        <button class={buttonStyle} content="{blue-fg}1:{/blue-fg} Purge log"/>
        <button clickable={true} onClick={restartContainer} class={buttonStyle} content="{blue-fg}2:{/blue-fg} Restart this container"/>
        <button clickable={true} onClick={restartAllContainers} class={buttonStyle} content="{blue-fg}3:{/blue-fg} Restart all containers"/>
        <button clickable={true} onClick={stopWatcher} class={buttonStyle} content="{blue-fg}4:{/blue-fg} Stop Watcher"/>
        <button clickable={true} onClick={startWatcher} class={buttonStyle} content="{blue-fg}5:{/blue-fg} Start Watcher"/>
        <button clickable={true} onClick={resetDB} class={buttonStyle} content="{blue-fg}6:{/blue-fg} Reset DB"/>
        <button clickable={true} onClick={hideHelp} class={buttonStyle} content="{blue-fg}?:{/blue-fg} Help"/>
      </layout>
    );
  }
}

const content = [
  "{center}{bold}keybindings{/bold}{/center}",
  "",
  "{cyan-fg}    left, right{/}  rotate through logs",
  "{cyan-fg}           h, ?{/}  toggle help",
  "{cyan-fg} esc, ctrl-c, q{/}  quit",
  "",
  "{right}{gray-fg}version: " + version + "{/}"
].join("\n");

class Help extends Component {
  render(){
    const style = {
      position: {
        top: "center",
        left: "center",
        width: 64,
        height: 10
      },
      border: "line",
      padding: {
        left: 1,
        right: 1
      },
      style: {
        border: {
          fg: "white"
        }
      },
      tags: true,
      content: content
    }
    const {hidden} = this.props;
    return (
      <box class={style} hidden={hidden}/>
    );
  }
}

const screen = blessed.screen({
  autoPadding: true,
  smartCSR: true,
  title: 'Sub0 devtools'
});

screen.key(['escape', 'q', 'C-c'], (ch, key) => {
  return process.exit(0);
});

render(<Dashboard />, screen);

process.on('exit', () => {
  pgLogsProc.kill();
  pgRestLogsProc.kill();
  oRestyLogsProc.kill();
  rmqLogsProc.kill();
  if(pgTailProc) pgTailProc.kill();
  if(pgRestTailProc) pgRestTailProc.kill();
  if(oRestyTailProc) oRestyTailProc.kill();
  if(rmqTailProc) rmqTailProc.kill();
  watcher.close();
});
