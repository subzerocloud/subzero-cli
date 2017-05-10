import {Component} from 'react';
import blessed from 'blessed';

class Spinner extends Component {
  constructor(props) {
    super(props);
    this.state = {
      text : '|',
		};
  }
  componentDidMount(){
    setInterval(this.spin, 200);
  }
  spin = () => {
    let {text} = this.state;
    let newText;
    switch(text){
      case '|' : newText = '/';  break;
      case '/' : newText = '-';  break;
      case '-' : newText = '\\'; break;
      case '\\': newText = '|';  break;
    }
    this.setState({text: newText});
  }
  render(){
    const {text} = this.state;
    return (
      <text {...this.props}>
        {text}
      </text>
    );
  }
}

export { Spinner as default };
