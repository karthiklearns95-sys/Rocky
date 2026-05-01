import React from 'react';
import { createRoot } from 'react-dom/client';
import Rocky from './components/Rocky/Rocky';
import './styles/rocky.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <Rocky />
  </React.StrictMode>
);
