import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './refinement.css';
import './light.css';
import './theme.css';
import './landing-redesign.css';
import './workspace-redesign.css';
import './readability-improvements.css';
import './dark-improvements.css';
import './live-layout.css';
import './verdict.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
