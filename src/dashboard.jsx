#!/usr/bin/env node
"use strict";

import fs from 'fs';

import proc from 'child_process';
import React, {Component} from 'react';
import blessed from 'blessed';
import {render} from 'react-blessed';

import {highlight} from 'cli-highlight';
import {StringDecoder} from 'string_decoder';
import Spinner from './spinner.js';
import {
    APP_DIR,
    LOG_LENGTH,
    WATCH_PATTERNS
} from './env.js';

import {resetDb, runWatcher, dockerContainers} from './watch.js';

import {checkIsAppDir} from './common.js';

const decoder = new StringDecoder('utf8');
//Workaround for a bug in the highlighting lib
const printLog = data => highlight(decoder.write(data), {language : 'accesslog'}).replace(/<span class=\"hljs-string\">/g, '').replace(/<\/span>/g, '');
const printSQL = data => highlight(decoder.write(data), {language : 'sql'});

class Dashboard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      containers: props.containers,
      containerOrder: Object.keys(props.containers),
      activeContainer: Object.keys(props.containers)[0],
      showHelp: false,
      watcherRunning: true
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
  stopWatcher = () => {
    const {activeContainer} = this.state;
    const logger = this.refs['log_'+activeContainer];
    if(this.watcher){ this.watcher.close(); this.watcher = null;}
    this.setState({watcherRunning:false});
    logger.log('Stopping watcher');
  }
  startWatcher = () => {
    const watcherReady = () => {
      const logger = this.refs['log_'+this.state.activeContainer];
      logger.log('Watching ' + WATCH_PATTERNS.map(p => p.replace(APP_DIR + '/','')).join(', ') + ' for changes.');
      logger.log('in ' + APP_DIR);
    }
    const reloadStart = relPath => {
      const logger = this.refs['log_'+this.state.activeContainer];
      logger.log(`${relPath} changed`);
      logger.log('Starting code reload ------------------------');
      this.refs['watcherSpinner'].start();
    }
    const reloadEnd = () => {
      const logger = this.refs['log_'+this.state.activeContainer];
      this.refs['watcherSpinner'].stop();
      logger.log('Ready ---------------------------------------');
    }
    this.setState({watcherRunning:true});
    if(this.watcher){ this.watcher.close(); }
    const {containers, activeContainer} = this.state;
    this.watcher = runWatcher(containers,
                              this.refs['log_' + activeContainer],
                              watcherReady, reloadStart, reloadEnd);
  }
  startLogTail = (key, timestamp) => {
    const {containers} = this.state;
    const logger = this.refs['log_'+key];
    const printer = key == 'db' ? printSQL : printLog;
    timestamp = timestamp ? timestamp : 0;
    if (containers[key].logProc) { containers[key].logProc.kill() }
    containers[key].logProc = proc.exec(`docker logs --tail 500 --since ${timestamp} -f ${containers[key].name} 2>&1`);
    containers[key].logProc.stdout.on('data', data => logger.log(printer(data)));
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
    logger.log(`Restarting ${container.title} container ...`)
    proc.spawn('docker',['restart', container.name]).on('close', (code) => {
      logger.log('Done');
      this.startLogTail(key, Math.floor(new Date() / 1000));
    });
  }
  clearLog = (key) => {
    const containerName = containers[key].name;
    const logFile = proc.execSync('docker inspect -f "{{.LogPath}}" ' + containerName ).toString('utf8').trim()
    fs.truncateSync(logFile, 0)
  }
  handleKeyPress = (key) => {
    const {activeContainer, containerOrder, containers, watcherRunning} = this.state,
          logger = this.refs['log_'+activeContainer];
    switch(key) {
        case 'left':
        case 'right':
          const total = containerOrder.length;
          let idx = containerOrder.indexOf(activeContainer)
          if(key == "left") { idx = (idx - 1 == -1)?(total - 1):(idx - 1); }
          if(key == "right") { idx = (idx + 1 == total)?0:(idx + 1); }
          this.selectContainer(idx);
          break;
        case 'c':// 'Clear log': {keys:['c']},
          //this.clearLog(activeContainer);
          logger.setContent('');
          break;
        case 't':// 'Restart this container': {keys:['t']}, this.restartContainer();
          this.restartContainer(activeContainer);
          break;
        case 'a':// 'Restart all containers'
          Object.keys(containers).map(k => this.restartContainer(k));
          break;
        case 'w':// 'Toggle Watcher'
          watcherRunning ? this.stopWatcher() : this.startWatcher();
          break;
        case 'r':// 'Reset DB'
          resetDb(containers, logger);
          break;
        case 'h':// 'Help': {keys:['?']}, this.hideHelp();
          this.setState({showHelp: !this.state.showHelp})
          break;
        // Quit program
        case 'q':
        case 'escape':
        case 'C-c':
          Object.keys(containers).map(c => containers[c].logProc.kill());
          if(this.watcher){ this.watcher.close();}
          process.exit(0);
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
          fg: "grey"
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
      keys: true,
      vi: true,
      scrollback: LOG_LENGTH,
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
          <log key={key} hidden={key != activeContainer} focused={key == activeContainer}
            ref={'log_' + key} top={1} label="Logs" class={logWindowStyle} />
        )}
        <listbar ref="bottomMenu" bottom={0} height={1} width="100%-2" left={2} autoCommandKeys={false} commands={{
          'Clear log': {keys:['c']},
          'Restart this container': {keys:['t']},
          'Restart all containers': {keys:['a']},
          'Toggle Watcher' : {keys:['w']},
          'Reset DB': {keys:['r']},
          'Help': {keys:['h']},
        }} />
        <box class={helpWindowOptions} hidden={!showHelp}/>

        <Spinner ref="watcherSpinner" bottom={0} left={0} />
      </element>
    );
  }
}

const screen = blessed.screen({
  autoPadding: true,
  smartCSR: true,
  title: 'subZero devtools',
  fullUnicode: true
});

const runDashboard = () => {
  checkIsAppDir();
  render(<Dashboard containers={dockerContainers()} />, screen);
}

runDashboard();
