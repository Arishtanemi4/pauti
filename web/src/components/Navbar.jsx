import React, { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';

const Navbar = () => {
  const { theme, toggleTheme } = useContext(ThemeContext);

  const navStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1rem 2rem',
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: `2px solid var(--accent-primary)`
  };

  const buttonStyle = {
    backgroundColor: 'var(--accent-primary)',
    color: 'var(--bg-primary)',
    border: 'none',
    padding: '0.5rem 1rem',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 'bold'
  };

  return (
    <nav style={navStyle}>
      <h2 style={{ margin: 0, color: 'var(--accent-secondary)' }}>ExpenseTracker</h2>
      <button onClick={toggleTheme} style={buttonStyle}>
        Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode
      </button>
    </nav>
  );
};

export default Navbar;