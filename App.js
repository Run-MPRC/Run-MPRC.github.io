import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import NavigationBar from './components/NavigationBar';
import Home from './pages/Home';
import Activities from './pages/Activities';
import Benefits from './pages/Benefits';
import JoinUs from './pages/JoinUs';
import ContactUs from './pages/ContactUs';

function App() {
  return (
    <Router>
      <NavigationBar />
      <Switch>
        <Route path="/" exact component={Home} />
        <Route path="/activities" component={Activities} />
        <Route path="/benefits" component={Benefits} />
        <Route path="/joinus" component={JoinUs} />
        <Route path="/contactus" component={ContactUs} />
      </Switch>
    </Router>
  );
}

export default App;
