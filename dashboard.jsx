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


config();//.env file vars added to process.env 

const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;
const POSTGRES_USER = process.env.POSTGRES_USER;
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
const watch = () => chokidar.watch(['sql/**/*.sql', 'lua/**/*.lua', 'nginx/**/*.conf']);
const pgReloaderProc = path => proc.spawn('docker',['exec', PG, 'psql', '-U', POSTGRES_USER, DB_NAME, '-c', `\\i ${path}`]);
const nginxHupperProc = () => proc.spawn('docker',['kill', '-s', 'HUP', OPENRESTY]);
const restartProc = (container, succ, err) => {
  let p = proc.spawn('docker',['restart', container]);
  p.stdout.on('data', succ);
  p.stderr.on('data', err);
}

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
      stopWatcher : false,
      startWatcher : false
		};
  }
  handleKeyPress = (ch, key) => {
    const k = key.name;
    if(k == "left" || k == "right"){
      const {hidden} = this.state;
      // Hide current log
      let idx = hidden.findIndex( x => !x );
      hidden[idx] = true;
      // Show next log and iterate circularly
      if(k == "left")
        idx = (idx - 1 == -1)?(hidden.length - 1):(idx - 1);
      if(k == "right")
        idx = (idx + 1 == hidden.length)?0:(idx + 1);
      hidden[idx] = false;
      this.setState({hidden: hidden, curIdx: idx});
    }
    if(ch == '2'){
      const {curIdx, restarted} = this.state;
      restarted[curIdx] = true;
      this.setState({restarted : restarted});
      this.clearRestarts();
    }
    if(ch == '3'){
      this.setState({restarted : [true, true, true, true]});
      this.clearRestarts();
    }
    if(ch == '4'){
      this.setState({stopWatcher : true});
      this.setState({stopWatcher : false}); // To prevent re-stopping
    }
    if(ch == '5'){
      this.setState({startWatcher : true});
      this.setState({startWatcher : false}); // To prevent re-starting
    }
  }
  // To prevent re-restarting
  clearRestarts = () => this.setState({restarted : [false, false, false, false]})
  render() {
    const { hidden, restarted, stopWatcher, startWatcher } = this.state;
    return (
      <element keyable={true} onKeypress={this.handleKeyPress}>
        <PgLog restart={restarted[0]} hidden={hidden[0]}/>
        <ORestyLog restart={restarted[1]} hidden={hidden[1]}/>
        <PgRESTLog restart={restarted[2]} hidden={hidden[2]}/>
        <RMQLog restart={restarted[3]} hidden={hidden[3]}/>
        <WatcherLog start={startWatcher} stop={stopWatcher}/>
        <Options/>
      </element>
    );
  }
}

class Options extends Component {
  render(){
    const buttonStyle = {
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'blue'
        }
      }
    };
    return (
      <layout top="95%" width="100%" height="5%">
        <button class={buttonStyle} content="1: Purge log"/>
        <button class={buttonStyle} content="2: Restart this container"/>
        <button class={buttonStyle} content="3: Restart all containers"/>
        <button class={buttonStyle} content="4: Stop Watcher"/>
        <button class={buttonStyle} content="5: Start Watcher"/>
        <button class={buttonStyle} content="?: Help"/>
      </layout>
    );
  }
}

const logStyle = {
	keys: true,
	vi: true,
	mouse: true,
	border: 'line',
	scrollback: 95,
	scrollbar: {
		ch: ' ',
		style: {
			inverse: true
		}
	},
	border: {
		type: 'line'
	}
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
      <log onRestart={this.handleRestart} hidden={hidden} ref="pgLog" label="Logs PostgreSQL" class={logStyle}
           width="70%" height="95%"/>
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
      <log hidden={hidden} ref="oRestyLog" label="Logs OpenResty" class={logStyle}
           width="70%" height="95%"/>
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
      <log hidden={hidden} ref="rmqLog" label="Logs RabbitMQ" class={logStyle}
           width="70%" height="95%"/>
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
      <log hidden={hidden} ref="pgRestLog" label="Logs PostgREST" class={logStyle}
           width="70%" height="95%"/>
    );
  }
}

class WatcherLog extends Component {
  componentWillReceiveProps(nextProps){
    let logger = this.refs.watcherLog;
    if(nextProps.stop){
      watcher.close();
      logger.log("Watcher stopped");
    }
    if(nextProps.start){
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
          let p = nginxHupperProc();
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
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="watcherLog" label="Watcher" class={logStyle}
           left="70%" width="30%" height="95%"/>
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
