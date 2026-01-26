import React from 'react';
import { ThemeProvider } from './context/ThemeContext';
import Dashboard from './pages/Dashboard';
import './styles/variables.css'; // Import the global variables

function App() {
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}

export default App;