#!/usr/bin/env node
"use strict";
import fs from 'fs';

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
// const COMPOSE_PROJECT_NAME='postgreststarterkit';
const SUPER_USER = process.env.SUPER_USER;
const SUPER_USER_PASSWORD = process.env.SUPER_USER_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_DIR = "docker-entrypoint-initdb.d/";
const TITLES = { 
  openresty: 'OpenResty',
  postgrest: 'PostgREST',
  db: 'PostgreSQL',
  rabbitmq: 'RabbitMQ'
}

if(!COMPOSE_PROJECT_NAME){
  console.log("\x1b[31mError:\x1b[0m You must set the COMPOSE_PROJECT_NAME var in the .env file");
  process.exit(0);
}

const container_list = proc.execSync('docker ps -a -f name=${COMPOSE_PROJECT_NAME} --format "{{.Names}}"').toString('utf8').trim().split("\n");
const containers = container_list.reduce( ( acc, containerName ) => {
  let key = containerName.replace(COMPOSE_PROJECT_NAME,'').replace('1','').replace(/_/g,'');
  acc[key] = {
    name: containerName,
    title: TITLES[key]
  }
  return acc
}, {});

const decoder = new StringDecoder('utf8');
//Workaround for a bug in the highlighting lib
const printLog = data => highlight(decoder.write(data), {language : 'accesslog'}).replace(/<span class=\"hljs-string\">/g, '').replace(/<\/span>/g, '');
const printSQL = data => highlight(decoder.write(data), {language : 'sql'});

class Dashboard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      containers: containers,
      containerOrder: Object.keys(containers),
      activeContainer: Object.keys(containers)[0],
      showHelp: false
    }
  }
  componentDidMount(){
    const {containers, activeContainer, containerOrder} = this.state;
    const refs = this.refs;
    const {topMenu, dashboard} = refs;
    
    topMenu.select(containerOrder.indexOf(activeContainer));
    dashboard.on("element keypress", (el, ch, key) => this.handleKeyPress(key.full));

    //start log tail procs
    Object.keys(containers).map(key => {
      this.startLogTail(key)
    })

    this.startWatcher();
  }
  componentWillUnmount() {
    const {containers} = this.state;
    Object.keys(containers).map(c => c.logProc.kill());
    this.watcher.kill();
  }
  startWatcher = () => {
    const {activeContainer} = this.state;
    const logger = this.refs['log_'+activeContainer];
    this.watcher = chokidar.watch(['**/*.sql', '**/*.lua', '**/*.conf'], { ignored : '**/tests/**'})
      .on('change', path => {
        logger.log(`${path} changed`);
        if(path.endsWith('.sql')){
          //try to optimistically execute just the changed file
          this.runSql( [DB_NAME,
            '-c', `\\i ${DB_DIR}/init.sql;`
          ])
          .on('close', (code) => {
            if(code != 0){
              this.resetDb();
            }
            else {
              this.sendHUP(containers['postgrest'].name);
              this.sendHUP(containers['openresty'].name);  
            }
          });
        }else{
          this.sendHUP(containers['openresty'].name);
        }
      })
      .on('ready', () => logger.log('Watching **/*.sql, **/*.lua, **/*.conf for changes.'));
  }
  startLogTail = (key, timestamp) => {
    const {containers} = this.state;
    const logger = this.refs['log_'+key];
    const printer = key == 'db' ? printSQL : printLog;
    timestamp = timestamp ? timestamp : 0;
    if (containers[key].logProc) { containers[key].logProc.kill() }
    containers[key].logProc = proc.spawn('docker',['logs', '--since', timestamp, '-f', containers[key].name]);
    containers[key].logProc.stdout.on('data', data => logger.log(printer(data)));
    containers[key].logProc.stderr.on('data', data => logger.log(printer(data)));
  }
  selectContainer = (idx) => {
    const {activeContainer, containerOrder} = this.state;
    const total = containerOrder.length;
    if (isNaN(idx) || idx >= total || idx < 0 ) return;
    this.setState({activeContainer: containerOrder[idx]});
    this.refs.topMenu.select(idx);
  }
  restartContainer = (key) => {
    const container = this.state.containers[key];
    const logger = this.refs['log_'+key];
    logger.log('Restarting container ...')
    proc.spawn('docker',['restart', container.name]).on('close', (code) => {
      logger.log('Done');
      //this.clearLog(key);
      this.startLogTail(key, Math.floor(new Date() / 1000));
    });
  }
  runSql = (commands) => {
    const {containers} = this.state;
    const connectParams = ['exec', containers['db'].name, 'psql', '-U', SUPER_USER]
    return proc.spawn('docker', connectParams.concat(commands))
  }
  sendHUP = (container) => proc.spawn('docker',['kill', '-s', 'HUP', container]);
  resetDb = () => {
    const {containers} = this.state;
    this.runSql( ['postgres',
      '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';`,
      '-c', `DROP DATABASE if exists ${DB_NAME};`,
      '-c', `CREATE DATABASE ${DB_NAME};`,
      '-c', `\\c ${DB_NAME}`,
      '-c', `\\i ${DB_DIR}/init.sql;`
    ])
    .on('close', (code) => {
        this.sendHUP(containers['postgrest'].name);
        this.sendHUP(containers['openresty'].name);
    });
    
  }
  clearLog = (key) => {
    const containerName = containers[key].name;
    const logFile = proc.execSync('docker inspect -f "{{.LogPath}}" ' + containerName ).toString('utf8').trim()
    fs.truncateSync(logFile, 0)
  }
  handleKeyPress = (key) => {
    const {activeContainer, containerOrder, containers} = this.state;
          
    switch(key) {
        case 'left':
        case 'right':
          const total = containerOrder.length;
          let idx = containerOrder.indexOf(activeContainer)
          if(key == "left") { idx = (idx - 1 == -1)?(total - 1):(idx - 1); }
          if(key == "right") { idx = (idx + 1 == total)?0:(idx + 1); }
          this.selectContainer(idx);
          break;
        // case 'c':// 'Clear log': {keys:['c']},
        //   this.clearLog(activeContainer);
        //   break;
        case 't':// 'Restart this container': {keys:['t']}, this.restartContainer();
          this.restartContainer(activeContainer);
          break;
        case 'a':// 'Restart all containers'
          Object.keys(containers).map(k => this.restartContainer(k));
          break;
        case 'w':// 'Toggle Watcher'
          break;
        case 'r':// 'Reset DB'
          this.resetDb();
          break;
        case 'h':// 'Help': {keys:['?']}, this.hideHelp();
          this.setState({showHelp: !this.state.showHelp})
          break;
        default:
          this.selectContainer(parseInt(key, 10) - 1);
    }
  }

  render() {
    const {containers, containerOrder, activeContainer, showHelp} = this.state;
    const containerTitles = containerOrder.map(key => containers[key].title);
    const topMenuStyle = {
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
    }
    const logWindowStyle = {
      border: {
        type: 'line',
        fg: 'green'
      },
      width: "100%",
      height: "100%-2",
      mouse: true,
      scrollback: 95,
      scrollbar: {
        ch: ' ',
        style: {
          inverse: true
        }
      }
    };

    const helpWindowOptions = {
      position: {
        top: "center",
        left: "center",
        width: 64,
        height: 10
      },
      border: "line",
      
      style: {
        border: {
          fg: "white"
        }
      },
      tags: true,
      content: [
        "{center}{bold}keybindings{/bold}{/center}",
        "",
        "{cyan-fg}    left, right{/}  rotate through logs",
        "{cyan-fg}              h{/}  toggle help",
        "{cyan-fg} esc, ctrl-c, q{/}  quit",
        "",
      ].join("\n")
    }
    return (
      <element keyable={true} ref="dashboard">
        <listbar ref="topMenu"  top={0} items={containerTitles} class={topMenuStyle} />
        {containerOrder.map( key =>
          <log key={key} hidden={key != activeContainer} ref={'log_' + key} top={1} label={containers[key].title} class={logWindowStyle} />
        )}
        <listbar ref="bottomMenu" bottom={0} height={1} autoCommandKeys={false} commands={{
          //'Clear log': {keys:['c']},
          'Restart this container': {keys:['t']},
          'Restart all containers': {keys:['a']},
          'Toggle Watcher': {keys:['w']},
          'Reset DB': {keys:['r']},
          'Help': {keys:['h']},
        }} />
        <box class={helpWindowOptions} hidden={!showHelp}/>
      </element>
    );
  }
}

const screen = blessed.screen({
  autoPadding: true,
  smartCSR: true,
  title: 'subZero devtools'
});

screen.key(['escape', 'q', 'C-c'], (ch, key) => {
  return process.exit(0);
});

render(<Dashboard />, screen);

process.on('exit', () => {
  //Object.keys(containers).map(c => c.logProc.kill());
  //watcher.close();
});
