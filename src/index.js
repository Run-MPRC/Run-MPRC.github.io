import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initSentry } from './services/monitoring/sentry';

initSentry();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
