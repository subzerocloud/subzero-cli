#!/usr/bin/env node
"use strict";

import proc from 'child_process';
import {highlight} from 'cli-highlight';
import {StringDecoder} from 'string_decoder'; 
import {config} from 'dotenv';
import watcher from 'chokidar';

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

const decoder = new StringDecoder('utf8');
const prettyPrint = (data, lang) => highlight(decoder.write(data), {language : lang});

const logsProc = container => proc.spawn('docker',['logs', '-f', container]);
const pgLogsProc = logsProc(`${COMPOSE_PROJECT_NAME}_db_1`);
const pgRestLogsProc = logsProc(`${COMPOSE_PROJECT_NAME}_postgrest_1`);
const oRestyLogsProc = logsProc(`${COMPOSE_PROJECT_NAME}_openresty_1`);
const rmqLogsProc = logsProc(`${COMPOSE_PROJECT_NAME}_rabbitmq_1`);

const pgWatcher = watcher.watch(['sql/**/*.sql']);
const luaWatcher = watcher.watch(['lua/**/*.lua']);
const nginxWatcher = watcher.watch(['nginx/**/*.conf']);

const pgReloaderProc = path => proc.spawn('docker',['exec', `${COMPOSE_PROJECT_NAME}_db_1`, 'psql', '-U', POSTGRES_USER, DB_NAME, '-c', `\\i ${path}`]);
const nginxHupperProc = () => proc.spawn('docker',['kill', '-s', 'HUP', `${COMPOSE_PROJECT_NAME}_openresty_1`]);

const restartProc = container => proc.spawn('docker',['restart', container]);

class Dashboard extends Component {
  constructor(props) {
    super(props);
    this.state = { 
			hiddenLogs : [false, true, true, true]
		};
  }
  handleKeyPress = (ch, key) => {
    const k = key.name;
    if(k == "left" || k == "right"){
      const {hiddenLogs} = this.state;
      // Hide current log
      let idx = hiddenLogs.findIndex( x => !x );
      hiddenLogs[idx] = true;
      // Show next log and iterate circularly
      if(k == "left")
        idx = (idx - 1 == -1)?(hiddenLogs.length - 1):(idx - 1);
      if(k == "right")
        idx = (idx + 1 == hiddenLogs.length)?0:(idx + 1);
      hiddenLogs[idx] = false;
      this.setState({ hiddenLogs: hiddenLogs });
    }
  }
  render() {
    const { hiddenLogs, message } = this.state;
    return (
      <element keyable={true} onKeypress={this.handleKeyPress}>
        <PgLog hidden={hiddenLogs[0]}/>
        <ORestyLog hidden={hiddenLogs[1]}/>
        <PgRESTLog hidden={hiddenLogs[2]}/>
        <RMQLog hidden={hiddenLogs[3]}/>
        <WatcherLog/>
        <Options/>
      </element>
    );
  }
}

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

class Options extends Component {
	constructor(props){
		super(props);
	}
  render(){
    const {hidden} = this.props;
    return (
      <layout top="95%" width="100%" height="5%">
        <button class={buttonStyle} content="1: Purge log"/>
        <button class={buttonStyle} content="2: Restart this container"/>
        <button class={buttonStyle} content="3: Restart all containers"/>
        <button class={buttonStyle} content="4: Stop Watching"/>
        <button class={buttonStyle} content="5: Start Watching"/>
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
	constructor(props){
		super(props);
	}
	componentDidMount(){
		pgLogsProc.stderr.on('data', data => this.refs.pgLog.log(prettyPrint(data, 'sql')) );
	}
  render(){
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="pgLog" label="Logs PostgreSQL" class={logStyle}
           width="70%" height="95%"/>
    );
  }
}

class ORestyLog extends Component {
	constructor(props){
		super(props);
	}
	componentDidMount(){
		oRestyLogsProc.stdout.on('data', data => this.refs.oRestyLog.log(prettyPrint(data, 'accesslog')));
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
	constructor(props){
		super(props);
	}
	componentDidMount(){
		rmqLogsProc.stdout.on('data', data => this.refs.rmqLog.log(prettyPrint(data, 'accesslog')));
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
	constructor(props){
		super(props);
	}
	componentDidMount(){
		pgRestLogsProc.stdout.on('data', data => this.refs.pgRestLog.log(prettyPrint(data, 'accesslog')));
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
	constructor(props){
		super(props);
	}
	componentDidMount(){
    let logger = this.refs.watcherLog;
    pgWatcher
      .on('change', path => {
        let proc = pgReloaderProc(path.replace('sql/', DB_DIR));
        logger.log(`${path} changed`);
        proc.stdout.on('data', data => logger.log(prettyPrint(data, 'sql')));
        proc.stderr.on('data', data => logger.log(prettyPrint(data, 'sql')));
      })
      .on('ready', () => logger.log('Watching sql/ directory for changes'));
    luaWatcher
      .on('change', path => {
        let proc = nginxHupperProc();
        logger.log(`${path} changed`);
        proc.stdout.on('data', data => logger.log("Nginx restarted"));
      })
      .on('ready', () => logger.log('Watching lua/ directory for changes'));
    nginxWatcher
      .on('change', path => {
        let proc = nginxHupperProc();
        logger.log(`${path} changed`);
        proc.stdout.on('data', data => logger.log("Nginx restarted"));
      })
      .on('ready', () => logger.log('Watching nginx/ directory for changes'));
	}
  render() {
    const {hidden} = this.props;
    return (
      <log hidden={hidden} ref="watcherLog" label="File watcher" class={logStyle}
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

process.on('exit', () => {
  pgLogsProc.kill();
  pgRestLogsProc.kill();
  oRestyLogsProc.kill();
  rmqLogsProc.kill();
});

render(<Dashboard />, screen);
