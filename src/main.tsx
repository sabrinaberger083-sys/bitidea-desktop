import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Design tokens must load first (defines CSS variables used everywhere),
// then globals which may reference them.
import './styles/tokens.css';
import './styles/globals.css';
// highlight.js theme for code blocks inside assistant markdown
import 'highlight.js/styles/github-dark.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
