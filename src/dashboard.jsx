#!/usr/bin/env node
"use strict";

import proc from 'child_process';
import React, {Component} from 'react';
import blessed from 'neo-blessed';
import {createBlessedRenderer} from 'react-blessed';
import sqlFormatter from "sql-formatter";

const render = createBlessedRenderer(blessed);

import {highlight} from 'cli-highlight';
import {StringDecoder} from 'string_decoder';
import {
    APP_DIR,
    LOG_LENGTH,
    WATCH_PATTERNS,
    FILTER_DB_APP_NAME,
    DB_CONTAIENR_NAME,
    DB_LOG_LINE_MARKER,
    HIDE_DB_LOG_LINE,
} from './env.js';
import {checkIsAppDir,resetDb, runWatcher, dockerContainers, restartContainer} from './common.js';

const decoder = new StringDecoder('utf8');

function filterStdoutDataDumpsToTextLines(callback, _breakOffFirstLine = /\r?\n/){ //returns a function that takes chunks of stdin data, aggregates it, and passes lines one by one through to callback, all as soon as it gets them.
    let acc = ''
    return function(data){
        let splitted = data.toString().split(_breakOffFirstLine)
        let inTactLines = splitted.slice(0, splitted.length-1)
        inTactLines[0] = acc+inTactLines[0] //if there was a partial, unended line in the previous dump, it is completed by the first section.
        acc = splitted[splitted.length-1] //if there is a partial, unended line in this dump, store it to be completed by the next (we assume there will be a terminating newline at some point. This is, generally, a safe assumption.)
        for(var i=0; i<inTactLines.length; ++i){
            callback(inTactLines[i])
        }
    }
}

//Workaround for a bug in the highlighting lib
const printLog = logger => {
  return function(data){
    logger.log(highlight(decoder.write(data), {language : 'accesslog'}).replace(/<span class=\"hljs-string\">/g, '').replace(/<\/span>/g, ''));
  }
}

const printSQL = logger => {
  let printMarkedLogLine = function(data){
    let line = decoder.write(data);
    if (FILTER_DB_APP_NAME && !line.match(FILTER_DB_APP_NAME)){
      return
    }
    if(HIDE_DB_LOG_LINE && line.match(HIDE_DB_LOG_LINE)){
      return
    }
    let match = line.match(/(.*)(LOG:\s+execute\s+[^:]+:)([\s\S]*)/);
    if(match){
      let sql = sqlFormatter.format(match[3]).split("\n").join("\n\t\t");
      logger.log(match[1] + match[2] + "\n" + highlight("\t\t"+sql, {language : 'sql', ignoreIllegals: true}) + "\n")
      //logger.log(match[1] + match[2] + "\n" + "\t\t"+sql + "\n")
    }
    else{
      logger.log(line);
    }
  }
  if( DB_LOG_LINE_MARKER ){
    return filterStdoutDataDumpsToTextLines(printMarkedLogLine, new RegExp(DB_LOG_LINE_MARKER, '') )
  }
  else{
    return function(data){ logger.log(decoder.write(data)); }
  }
  
}

class Dashboard extends Component {
  logProc = null
  constructor(props) {
    super(props);
    this.startLogTail = this.startLogTail.bind(this);
    this.handleKeyPress = this.handleKeyPress.bind(this);
    
    this.state = {
      containers: props.containers,
      containerOrder: Object.keys(props.containers),
      activeContainer: Object.keys(props.containers)[0],
      showHelp: false,
      watcherRunning: false,
      watcher: null,
      hideLog: false,
      // logProc: null,
    }
  }
  componentDidMount(){
    const {containers, activeContainer, containerOrder} = this.state;
    const refs = this.refs;
    const {dashboard} = refs;
    dashboard.on("element keypress", (el, ch, key) => this.handleKeyPress(key.full));
    if(Object.keys(containers).length == 0){
      console.log("No running containers. Exiting ...")
      process.exit();
    } 
    //start log tail procs
    Object.keys(containers).map(key => {
      this.startLogTail(key)
    })
    this.startWatcher();
  }
  stopWatcher = () => {
    const {watcherRunning, watcher, activeContainer} = this.state;
    const logger = this.refs['log_'+activeContainer];
    if(watcherRunning){ watcher.close();}
    this.setState({watcherRunning:false, watcher: null});
    logger.log('Stopping watcher');
  }
  startWatcher = () => {
    const self = this;
    const {watcherRunning, watcher, containers, activeContainer} = this.state;
    const watcherReady = () => {
      const {activeContainer} = self.state;
      const logger = this.refs['log_'+activeContainer];
      logger.log('Watching ' + WATCH_PATTERNS.map(p => p.replace(APP_DIR + '/','')).join(', ') + ' for changes.');
      logger.log('in ' + APP_DIR);
    }
    const reloadStart = relPath => {
      const {activeContainer} = self.state;
      const logger = this.refs['log_'+activeContainer];
      logger.log(`${relPath} changed`);
      logger.log('Starting code reload');
      //this.refs['watcherSpinner'].start();
    }
    const reloadEnd = (status) => {
      const {activeContainer} = self.state;
      const logger = this.refs['log_'+activeContainer];
      if(status == 0) logger.log('Ready');
    }
    if(watcherRunning){
      watcher.close();
    }
    
    this.setState({
      watcherRunning:true,
      watcher: runWatcher(containers,
        this.refs['log_'+activeContainer],
        watcherReady, reloadStart, reloadEnd)
    });
  }
  startLogTail = (key, timestamp, clearLog = true) => {
    const {containers} = this.state;
    const logger = this.refs['log_'+key];
    const printer = key == DB_CONTAIENR_NAME ? printSQL : printLog;
    timestamp = timestamp ? timestamp : 0;
    
    // if (this.logProc) { 
    //   //killAll(logProc.pid)
    //   this.logProc.kill()
    // }
    if (containers[key].logProc) { containers[key].logProc.kill() }
    // this.setState({hideLog: true});
    if(clearLog){
      logger.setContent('');
      logger.resetScroll();
    }
    containers[key].logProc = proc.spawn(
      "docker",
      [ 
        "logs", 
        "--tail", LOG_LENGTH, 
        "--since", `${timestamp}`, 
        "-f", 
        `${containers[key].name}`
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        'detached':true
      }
    );
   logger.scrollOnInput = false;
   containers[key].logProc.stdout.on('data', printer(logger));
   containers[key].logProc.stderr.on('data', printer(logger));
  //  setTimeout(function(){ self.setState({hideLog: false}); }, 100);
   
  }
  selectContainer = (idx) => {
    const {containerOrder} = this.state;
    const total = containerOrder.length;
    
    if (isNaN(idx) || idx >= total || idx < 0 ) return;
    const newActiveContainer = containerOrder[idx];
    this.setState({activeContainer: newActiveContainer});
    // this.startLogTail(newActiveContainer)
  }
  restartContainer = (key) => {
    const {containers, activeContainer} = this.state;
    const container = containers[key];
    const logger = this.refs['log_'+key];
    logger.log(`Restarting ${container.title} container ...`)
    const self = this;
    restartContainer(container.name, function(){
      logger.log('Done');
      self.startLogTail(key, Math.floor(new Date() / 1000), false);
    });
  }
  handleKeyPress = (key) => {
    const {activeContainer, containerOrder, containers, watcherRunning, watcher} = this.state,
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
          logger.setContent('');
          logger.resetScroll();
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
          if(this.logProc) this.logProc.kill(); //killAll(logProc.pid)
          if(watcherRunning){ watcher.close();}
          process.exit(0);
          break;
        default:
          this.selectContainer(parseInt(key, 10) - 1);
    }
  }

  render() {
    const {containers, containerOrder, showHelp, activeContainer, hideLog} = this.state;
    const containerTitles = containerOrder.map(key => containers[key].title);
    const activeContainerIndex = containerOrder.indexOf(activeContainer);
    const topMenuStyle = {
      border: {
        type: 'line',
        fg: 'green'
      },
      height: 3,
      style: {
        selected:{
          fg: "green"
        },
        prefix: {

        }
      }
    }
    const bottomMenuStyle = {
      style: {
        prefix: {},
        selected:{
          fg: "green"
        },
        item:{
          fg: "green"
        },
      },
    }
    const logWindowStyle = {
      width: "100%",
      height: "100%-5",
      keys: true,
      padding: {
        top: 0,
        left: 1,
        right: 1,
        bottom: 0
      },
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
        "{cyan-fg}  shift + mouse{/}  select text",
        "",
      ].join("\n")
    }
    return (
      <element keyable={true} ref="dashboard">
        <listbar selected={activeContainerIndex} top={0} items={containerTitles} class={topMenuStyle} />
        {/* <log hidden={hideLog} ref={'log_view'} mouse={true} keys={true} focused={true} top={3} class={logWindowStyle} /> */}
        {containerOrder.map( key =>
          <log key={key} hidden={key != activeContainer} mouse={true} focused={key == activeContainer} ref={'log_' + key} top={3} class={logWindowStyle} />
        )}
        <listbar ref="bottomMenu" bottom={0} height={1} width="100%-2" left={2} class={bottomMenuStyle} autoCommandKeys={false} commands={{
          'Clear log': {keys:['c']},
          'Restart this container': {keys:['t']},
          'Restart all containers': {keys:['a']},
          'Toggle Watcher' : {keys:['w']},
          'Reset DB': {keys:['r']},
          'Help': {keys:['h']},
        }} />
        <box class={helpWindowOptions} hidden={!showHelp}/>

        {/* <Spinner ref="watcherSpinner" bottom={0} left={0} /> */}
      </element>
    );
  }
}


const runDashboard = () => {
  checkIsAppDir();
  const screen = blessed.screen({
    autoPadding: true,
    smartCSR: true,
    title: 'subZero devtools',
    fullUnicode: true
  });  
  render(<Dashboard containers={dockerContainers()} />, screen);
}

runDashboard();
