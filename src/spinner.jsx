import React, {Component} from 'react';
import blessed from 'blessed';

class Spinner extends Component {
  constructor(props) {
    super(props);
    this.chars = this.props.chars || "|/-\\";
    this.delay = this.props.delay || 60;
    this.state = {
      current : null
    };
  }
  start = () => {
    this.setState({current: 0});
    this.interval = setInterval(this.spin, this.delay); 
  }
  stop = () => {
    clearInterval(this.interval);
    this.setState({current: null});
  }
  spin = () => {
    let {current} = this.state;
    this.setState({current: ++current % this.chars.length});
  }
  render(){
    const {current} = this.state
    const text = current !== null ? this.chars[this.state.current]:'';
    return (
      <text {...this.props}>
        {text}
      </text>
    );
  }
}

export { Spinner as default };
